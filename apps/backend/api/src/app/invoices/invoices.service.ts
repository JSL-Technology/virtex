import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, LessThanOrEqual, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Invoice,
  InvoiceStatus,
  InvoiceType,
  ModificationCode,
  PaymentMethod,
} from './entities/invoice.entity';
import { InvoiceLineItem, TaxTreatment } from './entities/invoice-line-item.entity';
import { CreateInvoiceDto, InvoiceLineDto } from './dto/create-invoice.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CustomersService } from '../customers/customers.service';
import { InventoryService } from '../inventory/inventory.service';
import { Product, ProductKind } from '../inventory/entities/product.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { FiscalAdapterFactory } from './adapters/fiscal-adapter.factory';
import { DocumentSequencesService } from '../shared/document-sequences/document-sequences.service';
import { DocumentType } from '../shared/document-sequences/entities/document-sequence.entity';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { EcfSubmissionService } from '../einvoicing/services/ecf-submission.service';
import { InvoicePostingService } from './services/invoice-posting.service';
import { computeDocument, roundToCurrency, TaxableLineInput } from './sales-tax.engine';
import { NcfType } from '../compliance/entities/ncf-sequence.entity';
import { TenantBookkeepingProvisioner } from '../shared/provisioning/tenant-bookkeeping.provisioner';
import { COUNTRY_TAX_SCHEMES } from '../localization/fiscal/country-tax-schemes';
import { EcfSubmission } from '../einvoicing/entities/ecf-submission.entity';
import { InvoiceRenderContext } from './services/invoice-renderer.service';
import { fiscalDate, organizationTimeZone } from '../shared/fiscal-clock';

export interface InvoiceListQuery {
  page?: number;
  limit?: number;
  status?: InvoiceStatus;
  customerId?: string;
  from?: string;
  to?: string;
  search?: string;
}

/** What the invoicing screen needs to present a correct form for this tenant's market. */
export interface InvoicingContext {
  ready: boolean;
  missing: string[];
  countryCode: string | null;
  baseCurrency: string;
  taxRates: number[];
  taxRequiresConfiguration: boolean;
  fiscalDocumentTypes: NcfType[];
  serviceChargeRate: number;
}

export interface PaginatedInvoices {
  items: Invoice[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * The sales-document lifecycle: build, issue, credit, collect.
 *
 * ## The shape of the rewrite
 *
 * A document is now built in two distinct steps, because conflating them was the source of several
 * defects at once:
 *
 * * **Building** computes the lines and totals and assigns an internal number. It consumes no
 *   fiscal numbering, moves no stock and posts nothing. This is what a draft is — previously every
 *   document was issued the moment it was created, so preparing one burned an e-NCF that the DGII
 *   then expected to receive.
 * * **Issuing** draws the fiscal number, moves the stock, posts the ledger entry and hands the
 *   document to the e-CF pipeline. All of it inside one transaction, so a document is never issued
 *   without its accounting, and its accounting never exists without the document.
 *
 * Amounts are never taken from the request. Prices and tax treatment come from the catalogue, the
 * arithmetic comes from `sales-tax.engine.ts`, and the request may only choose among options the
 * catalogue and the market actually allow.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    @InjectRepository(ExchangeRate)
    private readonly exchangeRateRepository: Repository<ExchangeRate>,
    private readonly customersService: CustomersService,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly documentSequencesService: DocumentSequencesService,
    private readonly fiscalAdapterFactory: FiscalAdapterFactory,
    private readonly saasService: SaasService,
    private readonly ecfSubmissionService: EcfSubmissionService,
    private readonly posting: InvoicePostingService,
    private readonly bookkeeping: TenantBookkeepingProvisioner,
  ) {}

  // ── Creation ───────────────────────────────────────────────────────────────

  /**
   * Create a document. Issued immediately unless the caller asks for a draft.
   *
   * The e-CF transmission is triggered AFTER the transaction commits: a slow or unreachable DGII
   * must never roll back a sale that is already recorded.
   */
  async create(dto: CreateInvoiceDto, organizationId: string): Promise<Invoice> {
    const issue = dto.issue !== false;

    const created = await this.dataSource.transaction(async (manager) => {
      const invoice = await this.buildDocument(dto, organizationId, manager);
      const saved = await manager.save(invoice);
      if (!issue) {
        this.logger.log(`Borrador ${saved.invoiceNumber} creado.`);
        return saved;
      }
      return this.issueWithin(saved, dto.fiscalDocumentType ?? null, organizationId, manager);
    });

    if (created.status !== InvoiceStatus.DRAFT) {
      this.eventEmitter.emit('invoice.issued', created);
      this.triggerEcfSubmission(created);
    }
    return created;
  }

  /** Turn an existing draft into an issued document. */
  async issue(invoiceId: string, organizationId: string, type?: NcfType): Promise<Invoice> {
    const issued = await this.dataSource.transaction(async (manager) => {
      const invoice = await manager.getRepository(Invoice).findOne({
        where: { id: invoiceId, organizationId },
        relations: ['lineItems', 'customer'],
      });
      if (!invoice) throw new NotFoundException(`Factura con ID "${invoiceId}" no encontrada.`);
      if (invoice.status !== InvoiceStatus.DRAFT) {
        throw new ConflictException(
          `El documento ${invoice.invoiceNumber} ya fue emitido; no puede emitirse de nuevo.`,
        );
      }
      return this.issueWithin(invoice, type ?? null, organizationId, manager);
    });

    this.eventEmitter.emit('invoice.issued', issued);
    this.triggerEcfSubmission(issued);
    return issued;
  }

  /**
   * Everything that makes a document real, in the caller's transaction: plan limit, fiscal number,
   * stock movement and ledger posting.
   */
  private async issueWithin(
    invoice: Invoice,
    requestedType: NcfType | null,
    organizationId: string,
    manager: EntityManager,
  ): Promise<Invoice> {
    // Counted at issuance, not at draft: a plan quota is about documents that exist fiscally.
    await this.saasService.enforceLimit(manager, organizationId, SaasResource.INVOICES);

    const adapter = await this.fiscalAdapterFactory.getAdapter(organizationId, manager);
    const assignment =
      invoice.type === InvoiceType.CREDIT_NOTE
        ? await adapter.assignCreditNoteNumber({
            invoice,
            organizationId,
            manager,
            requestedType,
            originalInvoice: await this.requireOriginal(invoice, organizationId, manager),
          })
        : await adapter.assignSalesNumber({ invoice, organizationId, manager, requestedType });

    invoice.ncfNumber = assignment.ncf;
    invoice.fiscalDocumentType = assignment.documentType;
    invoice.ncfExpiresAt = assignment.expiresAt;
    invoice.issuedAt = new Date();
    invoice.status =
      invoice.type === InvoiceType.CREDIT_NOTE ? InvoiceStatus.CREDIT_NOTE : InvoiceStatus.PENDING;

    if (invoice.type === InvoiceType.INVOICE) {
      await this.moveStockForIssue(invoice, manager);
    }

    await this.posting.post(invoice, manager);
    const saved = await manager.save(invoice);

    this.logger.log(
      `Documento ${saved.invoiceNumber}${saved.ncfNumber ? ` / ${saved.ncfNumber}` : ''} emitido ` +
        `por ${saved.total.toFixed(2)} ${saved.currencyCode}.`,
    );
    return saved;
  }

  /**
   * Build the document from the catalogue and the market's rules. Pure of side effects beyond
   * reading: no numbering, no stock, no posting.
   */
  private async buildDocument(
    dto: CreateInvoiceDto,
    organizationId: string,
    manager: EntityManager,
  ): Promise<Invoice> {
    const gaps = await this.bookkeeping.invoicingGaps(organizationId, manager);
    if (gaps.length > 0) {
      throw new BadRequestException(
        `La organización todavía no puede facturar. Falta: ${gaps.join('; ')}. ` +
          `Complétalo en Ajustes → Contabilidad.`,
      );
    }

    const organization = await manager.getRepository(Organization).findOne({
      where: { id: organizationId },
      select: ['id', 'country'],
    });
    const customer = await this.customersService.findOne(dto.customerId, organizationId);

    if (new Date(dto.dueDate) < new Date(dto.issueDate)) {
      throw new BadRequestException(
        'La fecha de vencimiento no puede ser anterior a la fecha de emisión.',
      );
    }

    const { currencyCode, exchangeRate } = await this.resolveCurrency(
      organizationId,
      dto.currencyCode,
      dto.issueDate,
    );

    const products = await this.loadProducts(dto.lineItems, organizationId, manager);
    const taxInputs: TaxableLineInput[] = [];
    const resolved: ResolvedLine[] = [];

    for (const [index, lineDto] of dto.lineItems.entries()) {
      const line = this.resolveLine(lineDto, products, index);
      resolved.push(line);
      taxInputs.push({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate,
        taxTreatment: line.taxTreatment,
        taxRate: line.taxRate,
        exciseRate: line.exciseRate,
        isService: line.isService,
      });
    }

    const computed = computeDocument({
      countryCode: organization?.country ?? null,
      currencyCode,
      lines: taxInputs,
      documentDiscountRate: dto.documentDiscountRate,
      serviceChargeRate: dto.serviceChargeRate,
      taxWithholdingRate: dto.taxWithholdingRate,
      incomeTaxWithholdingRate: dto.incomeTaxWithholdingRate,
    });

    const lineItems = resolved.map((line, index) => {
      const c = computed.lines[index];
      const entity = manager.create(InvoiceLineItem, {
        productId: line.productId,
        description: line.description,
        sortOrder: index,
        quantity: line.quantity,
        unitOfMeasure: line.unitOfMeasure,
        price: line.unitPrice,
        discountRate: line.discountRate,
        discountAmount: c.discountAmount,
        lineSubtotal: c.subtotal,
        taxRate: c.taxRate,
        taxAmount: c.taxAmount,
        taxTreatment: c.taxTreatment,
        isService: c.isService,
        exciseAmount: c.exciseAmount,
        unitCost: line.unitCost,
        creditedQuantity: 0,
      });
      return entity;
    });

    const invoiceNumber = await this.documentSequencesService.getNextNumber(
      organizationId,
      DocumentType.CUSTOMER_INVOICE,
      manager,
    );

    const costOfSale = roundToCurrency(
      resolved.reduce(
        (sum, line) => (line.movesStock ? sum + line.quantity * line.unitCost : sum),
        0,
      ),
      currencyCode,
    );

    return manager.create(Invoice, {
      organizationId,
      invoiceNumber,
      customerId: customer.id,
      customerName: customer.companyName,
      customerAddress: customer.address ?? null,
      customerTaxId: customer.taxId ?? null,
      issueDate: dto.issueDate,
      dueDate: dto.dueDate,
      lineItems,
      subtotal: computed.subtotal,
      discountTotal: computed.discountTotal,
      taxedTotal: computed.taxedTotal,
      exemptTotal: computed.exemptTotal,
      goodsTotal: computed.goodsTotal,
      servicesTotal: computed.servicesTotal,
      tax: computed.tax,
      serviceCharge: computed.serviceCharge,
      taxWithheld: computed.taxWithheld,
      incomeTaxWithheld: computed.incomeTaxWithheld,
      total: computed.total,
      netReceivable: computed.netReceivable,
      balance: computed.netReceivable,
      creditedTotal: 0,
      status: InvoiceStatus.DRAFT,
      type: InvoiceType.INVOICE,
      paymentMethod: dto.paymentMethod ?? this.inferPaymentMethod(dto),
      notes: dto.notes,
      currencyCode,
      exchangeRate,
      totalInBaseCurrency: roundToCurrency(computed.total * exchangeRate, currencyCode),
      costOfSale,
    });
  }

  // ── Line resolution ────────────────────────────────────────────────────────

  private async loadProducts(
    lines: InvoiceLineDto[],
    organizationId: string,
    manager: EntityManager,
  ): Promise<Map<string, Product>> {
    const ids = Array.from(new Set(lines.map((l) => l.productId).filter(Boolean))) as string[];
    if (ids.length === 0) return new Map();

    const products = await manager
      .getRepository(Product)
      .find({ where: { id: In(ids), organizationId } });

    const map = new Map(products.map((p) => [p.id, p]));
    const missing = ids.filter((id) => !map.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Producto${missing.length > 1 ? 's' : ''} no encontrado${missing.length > 1 ? 's' : ''} en el catálogo: ${missing.join(', ')}.`,
      );
    }
    return map;
  }

  /**
   * Turn a request line into a priced, classified line.
   *
   * The tax RATE is derived here, from the catalogue, and the request may only override the
   * TREATMENT (an export sale of a normally taxed good, say). Taking the rate from the client made
   * it impossible to distinguish an exempt item from a taxable one billed at zero.
   */
  private resolveLine(
    dto: InvoiceLineDto,
    products: Map<string, Product>,
    index: number,
  ): ResolvedLine {
    const product = dto.productId ? products.get(dto.productId) : undefined;

    const description = (dto.description ?? product?.name ?? '').trim();
    if (!description) {
      throw new BadRequestException(
        `La línea ${index + 1} necesita una descripción o un producto del catálogo.`,
      );
    }

    const unitPrice = dto.unitPrice ?? Number(product?.price ?? NaN);
    if (!Number.isFinite(unitPrice)) {
      throw new BadRequestException(
        `La línea ${index + 1} no tiene precio: indícalo o selecciona un producto del catálogo.`,
      );
    }

    const isService = dto.isService ?? product?.kind === ProductKind.SERVICE;
    const treatment = dto.taxTreatment ?? this.treatmentOf(product);
    const taxRate =
      treatment === TaxTreatment.TAXED
        ? (dto.taxRate ?? Number(product?.taxRate ?? 0))
        : 0;

    return {
      productId: product?.id ?? null,
      description,
      quantity: dto.quantity,
      unitPrice,
      discountRate: dto.discountRate ?? 0,
      taxTreatment: treatment,
      taxRate,
      exciseRate: Number(product?.exciseRate ?? 0),
      isService,
      unitOfMeasure: dto.unitOfMeasure ?? product?.unitOfMeasure ?? 'UND',
      unitCost: Number(product?.cost ?? 0),
      // Only a stocked good moves inventory. A service, or a free-text concept, does not.
      movesStock: Boolean(product) && !isService && product?.kind === ProductKind.GOOD,
    };
  }

  private treatmentOf(product: Product | undefined): TaxTreatment {
    const raw = (product?.taxTreatment ?? TaxTreatment.TAXED) as TaxTreatment;
    return Object.values(TaxTreatment).includes(raw) ? raw : TaxTreatment.TAXED;
  }

  /** A document due after its issue date is sold on credit; same-day is a cash sale. */
  private inferPaymentMethod(dto: CreateInvoiceDto): PaymentMethod {
    return dto.dueDate > dto.issueDate ? PaymentMethod.CREDIT : PaymentMethod.CASH;
  }

  // ── Currency ───────────────────────────────────────────────────────────────

  /**
   * Resolve the document currency and its rate to the tenant's functional currency.
   *
   * `exchange_rates.rate` is stored as units of `toCurrency` per 1 `fromCurrency` (base →
   * transaction). `Invoice.exchangeRate` is documented as the rate FROM the transaction currency TO
   * the base currency, so it is the inverse; multiplying by the raw rate inflated the base-currency
   * total by rate².
   */
  private async resolveCurrency(
    organizationId: string,
    requested: string | undefined,
    issueDate: string,
  ): Promise<{ currencyCode: string; exchangeRate: number }> {
    const settings = await this.orgSettingsRepository.findOne({ where: { organizationId } });
    const baseCurrency = settings?.baseCurrency || 'USD';
    const currencyCode = (requested || baseCurrency).toUpperCase();

    if (currencyCode === baseCurrency) return { currencyCode, exchangeRate: 1 };

    const rate = await this.exchangeRateRepository.findOne({
      where: {
        fromCurrency: baseCurrency,
        toCurrency: currencyCode,
        date: LessThanOrEqual(new Date(issueDate)),
      },
      order: { date: 'DESC' },
    });
    if (!rate) {
      throw new BadRequestException(
        `No hay una tasa de cambio de ${baseCurrency} a ${currencyCode} vigente al ${issueDate}. ` +
          `Regístrala en Ajustes → Monedas.`,
      );
    }

    const baseToTransaction = Number(rate.rate);
    if (!Number.isFinite(baseToTransaction) || baseToTransaction <= 0) {
      throw new BadRequestException(
        `La tasa de cambio configurada para ${currencyCode} no es válida.`,
      );
    }
    return { currencyCode, exchangeRate: 1 / baseToTransaction };
  }

  // ── Stock ──────────────────────────────────────────────────────────────────

  private async moveStockForIssue(invoice: Invoice, manager: EntityManager): Promise<void> {
    for (const line of invoice.lineItems ?? []) {
      if (!line.productId || line.isService) continue;
      await this.inventoryService.decreaseStock(
        line.productId,
        line.quantity,
        manager,
        invoice.organizationId,
      );
    }
  }

  // ── Drafts ─────────────────────────────────────────────────────────────────

  /** Replace the contents of a draft. Issued documents are immutable by law and by design. */
  async updateDraft(
    invoiceId: string,
    dto: CreateInvoiceDto,
    organizationId: string,
  ): Promise<Invoice> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Invoice);
      const existing = await repo.findOne({
        where: { id: invoiceId, organizationId },
        relations: ['lineItems'],
      });
      if (!existing) throw new NotFoundException(`Factura con ID "${invoiceId}" no encontrada.`);
      if (existing.status !== InvoiceStatus.DRAFT) {
        throw new ConflictException(
          'Solo se puede modificar un borrador. Un comprobante emitido se corrige con una nota de crédito.',
        );
      }

      const rebuilt = await this.buildDocument(dto, organizationId, manager);
      // Keep identity and numbering; replace contents.
      await manager.getRepository(InvoiceLineItem).delete({ invoiceId: existing.id });

      Object.assign(existing, {
        customerId: rebuilt.customerId,
        customerName: rebuilt.customerName,
        customerAddress: rebuilt.customerAddress,
        customerTaxId: rebuilt.customerTaxId,
        issueDate: rebuilt.issueDate,
        dueDate: rebuilt.dueDate,
        lineItems: rebuilt.lineItems,
        subtotal: rebuilt.subtotal,
        discountTotal: rebuilt.discountTotal,
        taxedTotal: rebuilt.taxedTotal,
        exemptTotal: rebuilt.exemptTotal,
        goodsTotal: rebuilt.goodsTotal,
        servicesTotal: rebuilt.servicesTotal,
        tax: rebuilt.tax,
        serviceCharge: rebuilt.serviceCharge,
        taxWithheld: rebuilt.taxWithheld,
        incomeTaxWithheld: rebuilt.incomeTaxWithheld,
        total: rebuilt.total,
        netReceivable: rebuilt.netReceivable,
        balance: rebuilt.netReceivable,
        paymentMethod: rebuilt.paymentMethod,
        notes: rebuilt.notes,
        currencyCode: rebuilt.currencyCode,
        exchangeRate: rebuilt.exchangeRate,
        totalInBaseCurrency: rebuilt.totalInBaseCurrency,
        costOfSale: rebuilt.costOfSale,
      });

      return manager.save(existing);
    });
  }

  /** Discard a draft. It consumed no fiscal numbering, so nothing needs to be declared. */
  async discardDraft(invoiceId: string, organizationId: string): Promise<void> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id: invoiceId, organizationId },
    });
    if (!invoice) throw new NotFoundException(`Factura con ID "${invoiceId}" no encontrada.`);
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException(
        'Un comprobante emitido no se elimina: anúlalo con una nota de crédito.',
      );
    }
    await this.invoicesRepository.delete({ id: invoiceId, organizationId });
  }

  // ── Credit notes ───────────────────────────────────────────────────────────

  /**
   * Credit part or all of an issued invoice.
   *
   * ## What this fixes
   *
   * The previous implementation validated each requested quantity against the ORIGINAL line and
   * kept no record of what had already been credited, so ten partial notes could each credit the
   * full quantity. A partial note also left the invoice's balance untouched — the customer returned
   * goods and still owed the full amount — and the code said so: "Let's keep it simple".
   *
   * Now every line carries `creditedQuantity`, the invoice carries `creditedTotal`, both are
   * checked before the note is built, and the note reduces the outstanding balance.
   */
  async createCreditNote(dto: CreateCreditNoteDto, organizationId: string): Promise<Invoice> {
    const created = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Invoice);

      // Serialise concurrent credit notes against the same invoice: two of them checking the
      // remaining creditable amount at once would both pass and together over-credit it. The lock
      // is taken on the invoice row alone — `FOR UPDATE` cannot be applied to the nullable side of
      // the outer joins that loading the relations produces.
      await repo
        .createQueryBuilder('invoice')
        .where('invoice.id = :id', { id: dto.invoiceId })
        .andWhere('invoice.organizationId = :organizationId', { organizationId })
        .setLock('pessimistic_write')
        .getOne();

      const original = await repo.findOne({
        where: { id: dto.invoiceId, organizationId },
        relations: ['lineItems', 'customer'],
      });

      if (!original) {
        throw new NotFoundException(`Factura original con ID "${dto.invoiceId}" no encontrada.`);
      }
      if (original.status === InvoiceStatus.DRAFT) {
        throw new BadRequestException(
          'Un borrador no se acredita: elimínalo o modifícalo directamente.',
        );
      }
      if (original.status === InvoiceStatus.VOID) {
        throw new ConflictException('La factura ya fue anulada en su totalidad.');
      }
      if (original.type !== InvoiceType.INVOICE) {
        throw new BadRequestException('Solo una factura puede ser acreditada.');
      }

      const selections = this.resolveCreditSelections(original, dto);
      const isFullCredit = this.isFullCredit(original, selections);

      const computed = computeDocument({
        countryCode: (
          await manager
            .getRepository(Organization)
            .findOne({ where: { id: organizationId }, select: ['id', 'country'] })
        )?.country,
        currencyCode: original.currencyCode,
        lines: selections.map((s) => ({
          quantity: s.quantity,
          unitPrice: s.line.price,
          discountRate: s.line.discountRate,
          taxTreatment: s.line.taxTreatment,
          taxRate: s.line.taxRate,
          isService: s.line.isService,
        })),
        // The note inherits the invoice's document-level rates so the credit mirrors what was
        // actually charged, proportionally.
        documentDiscountRate: proportion(original.discountTotal, original.subtotal),
        serviceChargeRate: proportion(
          original.serviceCharge,
          original.subtotal - original.discountTotal,
        ),
        taxWithholdingRate: proportion(original.taxWithheld, original.tax),
        incomeTaxWithholdingRate: proportion(
          original.incomeTaxWithheld,
          original.subtotal - original.discountTotal,
        ),
      });

      if (computed.total > original.creditableRemaining + 0.005) {
        throw new BadRequestException(
          `El importe a acreditar (${computed.total.toFixed(2)}) excede el saldo acreditable de la ` +
            `factura ${original.invoiceNumber} (${original.creditableRemaining.toFixed(2)}).`,
        );
      }

      const creditNoteNumber = await this.documentSequencesService.getNextNumber(
        organizationId,
        DocumentType.CREDIT_NOTE,
        manager,
      );

      // The credit note's own date, in the TENANT's zone. Taken from the server clock in UTC, a
      // note raised in Santo Domingo after 20:00 was dated tomorrow — and a note dated after the
      // period close lands in a month the taxpayer has already reported.
      const today = await this.fiscalToday(organizationId, manager);
      const noteLines = selections.map((s, index) => {
        const c = computed.lines[index];
        return manager.create(InvoiceLineItem, {
          productId: s.line.productId,
          sourceLineId: s.line.id,
          description: s.line.description,
          sortOrder: index,
          quantity: s.quantity,
          unitOfMeasure: s.line.unitOfMeasure,
          price: s.line.price,
          discountRate: s.line.discountRate,
          discountAmount: c.discountAmount,
          lineSubtotal: c.subtotal,
          taxRate: c.taxRate,
          taxAmount: c.taxAmount,
          taxTreatment: c.taxTreatment,
          isService: c.isService,
          unitCost: s.line.unitCost,
          creditedQuantity: 0,
        });
      });

      const restock = dto.restockGoods !== false;
      const costOfSale = restock
        ? roundToCurrency(
            selections.reduce(
              (sum, s) => (s.line.productId && !s.line.isService ? sum + s.quantity * s.line.unitCost : sum),
              0,
            ),
            original.currencyCode,
          )
        : 0;

      const creditNote = manager.create(Invoice, {
        organizationId,
        invoiceNumber: creditNoteNumber,
        originalInvoiceId: original.id,
        modificationCode:
          dto.modificationCode ??
          (isFullCredit ? ModificationCode.ANNULMENT : ModificationCode.AMOUNT_CORRECTION),
        status: InvoiceStatus.DRAFT,
        type: InvoiceType.CREDIT_NOTE,
        customerId: original.customerId,
        customerName: original.customerName,
        customerAddress: original.customerAddress,
        customerTaxId: original.customerTaxId,
        issueDate: today,
        dueDate: today,
        currencyCode: original.currencyCode,
        exchangeRate: original.exchangeRate,
        paymentMethod: original.paymentMethod,
        lineItems: noteLines,
        subtotal: computed.subtotal,
        discountTotal: computed.discountTotal,
        taxedTotal: computed.taxedTotal,
        exemptTotal: computed.exemptTotal,
        goodsTotal: computed.goodsTotal,
        servicesTotal: computed.servicesTotal,
        tax: computed.tax,
        serviceCharge: computed.serviceCharge,
        taxWithheld: computed.taxWithheld,
        incomeTaxWithheld: computed.incomeTaxWithheld,
        total: computed.total,
        netReceivable: computed.netReceivable,
        balance: 0,
        creditedTotal: 0,
        totalInBaseCurrency: roundToCurrency(
          computed.total * original.exchangeRate,
          original.currencyCode,
        ),
        costOfSale,
        notes: dto.reason || `Nota de crédito de la factura ${original.invoiceNumber}`,
      });

      const savedNote = await manager.save(creditNote);
      const issuedNote = await this.issueWithin(savedNote, null, organizationId, manager);

      // Return the goods to stock, unless the credit is a price adjustment or the goods came back
      // unsellable.
      if (restock) {
        for (const selection of selections) {
          if (!selection.line.productId || selection.line.isService) continue;
          await this.inventoryService.increaseStock(
            selection.line.productId,
            selection.quantity,
            manager,
            organizationId,
          );
        }
      }

      // Record the credit against the original, so a second note cannot credit the same goods.
      for (const selection of selections) {
        selection.line.creditedQuantity = round6(
          selection.line.creditedQuantity + selection.quantity,
        );
        await manager.save(selection.line);
      }
      original.creditedTotal = roundToCurrency(
        original.creditedTotal + computed.total,
        original.currencyCode,
      );
      original.balance = roundToCurrency(
        Math.max(0, original.balance - computed.netReceivable),
        original.currencyCode,
      );
      if (isFullCredit) {
        original.status = InvoiceStatus.VOID;
        original.voidedAt = new Date();
        original.voidReason = dto.reason ?? 'Anulada por nota de crédito total';
        original.balance = 0;
      } else if (original.balance <= 0.005) {
        original.status = InvoiceStatus.PAID;
        original.balance = 0;
      }
      await manager.save(original);

      this.eventEmitter.emit('invoice.credit-note-created', {
        originalInvoice: original,
        creditNote: issuedNote,
      });
      return issuedNote;
    });

    this.triggerEcfSubmission(created);
    return created;
  }

  /** Which lines and quantities the note credits, validated against what is still creditable. */
  private resolveCreditSelections(
    original: Invoice,
    dto: CreateCreditNoteDto,
  ): CreditSelection[] {
    const lines = original.lineItems ?? [];
    if (lines.length === 0) {
      throw new BadRequestException('La factura original no tiene líneas que acreditar.');
    }

    if (!dto.items || dto.items.length === 0) {
      const selections = lines
        .map((line) => ({ line, quantity: round6(line.quantity - line.creditedQuantity) }))
        .filter((s) => s.quantity > 0);
      if (selections.length === 0) {
        throw new ConflictException('La factura ya fue acreditada en su totalidad.');
      }
      return selections;
    }

    const byId = new Map(lines.map((line) => [line.id, line]));
    const selections: CreditSelection[] = [];
    const seen = new Set<string>();

    for (const item of dto.items) {
      if (seen.has(item.lineId)) {
        throw new BadRequestException(`La línea ${item.lineId} aparece dos veces en la solicitud.`);
      }
      seen.add(item.lineId);

      const line = byId.get(item.lineId);
      if (!line) {
        throw new BadRequestException(
          `La línea ${item.lineId} no pertenece a la factura ${original.invoiceNumber}.`,
        );
      }
      const available = round6(line.quantity - line.creditedQuantity);
      if (item.quantity > available + 1e-6) {
        throw new BadRequestException(
          `No se puede acreditar ${item.quantity} de "${line.description}": ` +
            `quedan ${available} por acreditar de ${line.quantity} facturadas.`,
        );
      }
      selections.push({ line, quantity: item.quantity });
    }
    return selections;
  }

  /** True when the note exhausts every remaining quantity on the invoice. */
  private isFullCredit(original: Invoice, selections: CreditSelection[]): boolean {
    const requested = new Map(selections.map((s) => [s.line.id, s.quantity]));
    return (original.lineItems ?? []).every((line) => {
      const remaining = round6(line.quantity - line.creditedQuantity);
      return remaining <= 1e-6 || Math.abs((requested.get(line.id) ?? 0) - remaining) <= 1e-6;
    });
  }

  private async requireOriginal(
    invoice: Invoice,
    organizationId: string,
    manager: EntityManager,
  ): Promise<Invoice> {
    if (!invoice.originalInvoiceId) {
      throw new BadRequestException('Una nota de crédito debe referenciar la factura que modifica.');
    }
    const original = await manager
      .getRepository(Invoice)
      .findOne({ where: { id: invoice.originalInvoiceId, organizationId } });
    if (!original) {
      throw new NotFoundException('La factura referenciada por la nota de crédito no existe.');
    }
    return original;
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /**
   * Paginated listing.
   *
   * The previous `findAll` returned every invoice of the tenant with its customer relation, over a
   * table whose only index was its primary key. On any real dataset that is a sequential scan of
   * every tenant's invoices per request; the client then downloaded the whole list a second time
   * just to compute "previous / next".
   */
  async findAll(organizationId: string, query: InvoiceListQuery = {}): Promise<PaginatedInvoices> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));

    const qb = this.invoicesRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.customer', 'customer')
      .where('invoice.organizationId = :organizationId', { organizationId });

    if (query.status) qb.andWhere('invoice.status = :status', { status: query.status });
    if (query.customerId) qb.andWhere('invoice.customerId = :customerId', { customerId: query.customerId });
    if (query.from) qb.andWhere('invoice.issueDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('invoice.issueDate <= :to', { to: query.to });
    if (query.search) {
      qb.andWhere(
        '(invoice.invoiceNumber ILIKE :search OR invoice.ncfNumber ILIKE :search OR invoice.customerName ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    const [items, total] = await qb
      .orderBy('invoice.issueDate', 'DESC')
      .addOrderBy('invoice.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  async findOne(id: string, organizationId: string): Promise<Invoice> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id, organizationId },
      relations: ['lineItems', 'lineItems.product', 'customer'],
    });
    if (!invoice) {
      throw new NotFoundException(`Factura con ID "${id}" no encontrada.`);
    }
    invoice.lineItems?.sort((a, b) => a.sortOrder - b.sortOrder);
    return invoice;
  }

  /**
   * Everything the printed representation needs: the document, the issuer, and the e-CF submission
   * that carries the security code and QR the norm requires on the page.
   */
  async renderContext(
    invoiceId: string,
    organizationId: string,
  ): Promise<{ invoice: Invoice; context: InvoiceRenderContext }> {
    const invoice = await this.findOne(invoiceId, organizationId);
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
    });
    if (!organization) throw new NotFoundException('Organización no encontrada.');

    const submission = await this.dataSource.getRepository(EcfSubmission).findOne({
      where: { invoiceId: invoice.id, organizationId },
    });

    return { invoice, context: { invoice, organization, submission } };
  }

  /**
   * Everything the invoicing screen needs before it can present a sensible form: whether the tenant
   * can issue at all, in which currency, and which fiscal document types its market offers.
   *
   * The client used to hardcode `USD` as the default currency and `0.18` as the tax rate on every
   * line, for every market — so a Mexican tenant saw an 18 % rate where the IVA is 16 %, and a
   * Dominican one invoiced in dollars by default. A client cannot know these; the server does.
   */
  async invoicingContext(organizationId: string): Promise<InvoicingContext> {
    const [missing, organization, settings] = await Promise.all([
      this.bookkeeping.invoicingGaps(organizationId, this.dataSource.manager),
      this.organizationRepository.findOne({
        where: { id: organizationId },
        select: ['id', 'country'],
      }),
      this.orgSettingsRepository.findOne({ where: { organizationId } }),
    ]);

    const countryCode = organization?.country ?? null;
    const adapter = this.fiscalAdapterFactory.forCountry(countryCode);
    const scheme = countryCode ? COUNTRY_TAX_SCHEMES[countryCode.toUpperCase()] : undefined;

    return {
      ready: missing.length === 0,
      missing,
      countryCode,
      baseCurrency: settings?.baseCurrency ?? 'USD',
      /** Rates the market levies, as fractions, highest first: the standard rate leads. */
      taxRates: (scheme?.taxes ?? []).map((t) => t.rate / 100).sort((a, b) => b - a),
      taxRequiresConfiguration: scheme?.configurationRequired ?? true,
      fiscalDocumentTypes: [...adapter.availableSalesTypes()],
      /** The legal service charge the market applies, as a fraction. Zero where none applies. */
      serviceChargeRate: countryCode === 'DO' || countryCode === 'CR' ? 0.1 : 0,
    };
  }

  /**
   * Today's date as the TENANT's tax authority reads it, `YYYY-MM-DD`.
   *
   * Not `new Date().toISOString()`. The server runs in UTC and every market this product sells into
   * is behind it, so between 20:00 and midnight local the UTC date is already tomorrow: a document
   * dated a day into the future, and on the last evening of a month, a document reported in the
   * wrong period.
   */
  private async fiscalToday(organizationId: string, manager?: EntityManager): Promise<string> {
    const repo = manager ? manager.getRepository(Organization) : this.organizationRepository;
    const org = await repo.findOne({
      where: { id: organizationId },
      select: ['id', 'country', 'timezone'],
    });
    return fiscalDate(organizationTimeZone(org));
  }

  // ── e-CF ───────────────────────────────────────────────────────────────────

  /**
   * Hand an electronic document to the e-CF pipeline, after the sale is committed.
   *
   * Fire-and-forget by design: the submission row records the outcome and the reconciler retries
   * anything left in contingency or error. A DGII outage must not fail a sale that is already made.
   */
  private triggerEcfSubmission(invoice: Invoice): void {
    if (!invoice.isElectronicFiscalDocument) return;
    this.ecfSubmissionService
      .submitInvoice(invoice.id, invoice.organizationId)
      .catch((error) =>
        this.logger.error(
          `Fallo al transmitir el e-CF del documento ${invoice.invoiceNumber}: ${(error as Error).message}`,
        ),
      );
  }
}

interface ResolvedLine {
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  taxTreatment: TaxTreatment;
  taxRate: number;
  exciseRate: number;
  isService: boolean;
  unitOfMeasure: string;
  unitCost: number;
  movesStock: boolean;
}

interface CreditSelection {
  line: InvoiceLineItem;
  quantity: number;
}

/** Safe ratio: zero when the denominator is zero, which is the correct rate for "nothing charged". */
function proportion(part: number, whole: number): number {
  if (!Number.isFinite(whole) || Math.abs(whole) < 1e-9) return 0;
  const ratio = part / whole;
  return ratio > 0 && ratio <= 1 ? ratio : 0;
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}
