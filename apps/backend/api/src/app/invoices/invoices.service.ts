

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, DataSource, LessThanOrEqual, LessThan, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Invoice, InvoiceStatus, InvoiceType } from './entities/invoice.entity';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CustomersService } from '../customers/customers.service';
import { InventoryService } from '../inventory/inventory.service';
import { Product } from '../inventory/entities/product.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import * as puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { NcfType } from '../compliance/entities/ncf-sequence.entity';
import { ComplianceService } from '../compliance/compliance.service';
import { FiscalAdapterFactory } from './adapters/fiscal-adapter.factory';
import { DocumentSequencesService } from '../shared/document-sequences/document-sequences.service';
import { DocumentType } from '../shared/document-sequences/entities/document-sequence.entity';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { Buffer } from 'buffer';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { EcfSubmissionService } from '../einvoicing/services/ecf-submission.service';
import { assertAllowedTaxRate } from './tax-engine';
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_LOCALE,
  LANGUAGE_DIRECTION,
  LanguageCode,
  isLanguageCode,
  matchLanguage,
  resolveLocale,
} from '@virteex/shared/types';
import { I18nService } from '../i18n/i18n.service';
import { findCountryProfile } from '../localization/fiscal/country-profiles';
import { principalTaxName } from '../localization/fiscal/country-tax-schemes';
import { languageOfCountry } from '../localization/fiscal/country-language';

@Injectable()
export class InvoicesService {
  private invoiceTemplate: HandlebarsTemplateDelegate;
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(Organization)
    private organizationRepository: Repository<Organization>,
    @InjectRepository(OrganizationSettings)
    private orgSettingsRepository: Repository<OrganizationSettings>,
    @InjectRepository(ExchangeRate)
    private exchangeRateRepository: Repository<ExchangeRate>,
    private customersService: CustomersService,
    private inventoryService: InventoryService,
    private dataSource: DataSource,
    private eventEmitter: EventEmitter2,
    private readonly complianceService: ComplianceService,
    private readonly documentSequencesService: DocumentSequencesService,
    private readonly fiscalAdapterFactory: FiscalAdapterFactory,
    private readonly saasService: SaasService,
    private readonly ecfSubmissionService: EcfSubmissionService,
    private readonly i18n: I18nService,
  ) {
    this.compileTemplate();
  }


  findOverdueInvoices(): Promise<Invoice[]> {
    const today = new Date();
    return this.invoicesRepository.find({
      where: {
        dueDate: LessThan(today.toISOString().split('T')[0]),
        status: In([InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID]),
      },
      relations: ['customer'],
    });
  }


  /**
   * Compile the invoice template once, with the helpers it needs to be readable in any market.
   *
   * `formatNumber` used to pin every figure to `en-US` and the template printed a literal `$` in
   * front of it, so a DOP invoice read as dollars, an Argentine one lost its thousands separator,
   * and a Chilean one grew two decimal places its currency does not have. The helpers now take
   * the locale from the document being rendered and the currency from the invoice itself.
   */
  private async compileTemplate() {
    try {
        const templatePath = path.join(__dirname, 'templates', 'invoice.hbs');
        const templateHtml = fs.readFileSync(templatePath, 'utf8');

        const localeOf = (options: handlebars.HelperOptions): string => {
          const root = options?.data?.root as { locale?: unknown } | undefined;
          return typeof root?.locale === 'string' ? root.locale : DEFAULT_LOCALE;
        };
        const languageOf = (options: handlebars.HelperOptions): LanguageCode => {
          const root = options?.data?.root as { language?: unknown } | undefined;
          return isLanguageCode(root?.language) ? root.language : DEFAULT_LANGUAGE;
        };

        handlebars.registerHelper('t', (key: unknown, options: handlebars.HelperOptions) =>
          typeof key === 'string'
            ? this.i18n.translate(key, languageOf(options), { ...(options?.hash ?? {}) })
            : '',
        );

        handlebars.registerHelper('number', (value: unknown, options: handlebars.HelperOptions) => {
          const amount = typeof value === 'number' ? value : Number(value);
          return Number.isFinite(amount) ? new Intl.NumberFormat(localeOf(options)).format(amount) : '';
        });

        handlebars.registerHelper(
          'money',
          (value: unknown, currency: unknown, options: handlebars.HelperOptions) => {
            const amount = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(amount)) return '';
            const code = typeof currency === 'string' && currency ? currency.toUpperCase() : 'USD';
            try {
              return new Intl.NumberFormat(localeOf(options), {
                style: 'currency',
                currency: code,
              }).format(amount);
            } catch {
              // An unrecognised ISO code must not blank the total on an invoice.
              return `${code} ${amount.toFixed(2)}`;
            }
          },
        );

        handlebars.registerHelper('dir', (options: handlebars.HelperOptions) =>
          LANGUAGE_DIRECTION[languageOf(options)],
        );

        handlebars.registerHelper('multiply', (a: number, b: number) => a * b);

        this.invoiceTemplate = handlebars.compile(templateHtml);
    } catch (error) {
        this.logger.error('Could not compile the invoice PDF template.', error);
    }
  }

  async create(
    createInvoiceDto: CreateInvoiceDto,
    organizationId: string,
  ): Promise<Invoice> {
    const created = await this.dataSource.transaction(async (manager) => {
      // Enforce SaaS Limit transactionally
      await this.saasService.enforceLimit(manager, organizationId, SaasResource.INVOICES);

      const customer = await this.customersService.findOne(
        createInvoiceDto.customerId,
        organizationId,
      );

      const settings = await this.getOrgAccountingConfig(organizationId);

      // Tax rates are validated server-side against the organization's market so a client cannot bill
      // an invented rate. See tax-engine.ts.
      const organization = await manager.findOne(Organization, {
        where: { id: organizationId },
        select: ['id', 'country'],
      });
      const orgCountry = organization?.country ?? null;

      let subtotal = 0;
      let totalTax = 0;
      const detailedLineItems: InvoiceLineItem[] = [];

      for (const itemDto of createInvoiceDto.lineItems) {
        const product = await manager.findOneBy(Product, {
          id: itemDto.productId,
          organizationId,
        });
        if (!product) {
          throw new BadRequestError('INVOICES.PRODUCTO_ID_NO_ENCONTRADO', { productId: itemDto.productId });
        }

        const linePrice = itemDto.price ?? product.price;
        const lineTotal = linePrice * itemDto.quantity;
        
        // Calculate tax per line. If taxRate is undefined we default to 0; whatever the value, it is
        // validated against the market's real tax rates so an invalid rate is rejected up front.
        const lineTaxRate = itemDto.taxRate !== undefined ? itemDto.taxRate : 0;
        assertAllowedTaxRate(orgCountry, lineTaxRate);
        const lineTaxAmount = lineTotal * lineTaxRate;

        subtotal += lineTotal;
        totalTax += lineTaxAmount;

        const lineItem = new InvoiceLineItem();
        lineItem.product = product;
        lineItem.description = itemDto.description ?? product.name;
        lineItem.quantity = itemDto.quantity;
        lineItem.price = linePrice;
        lineItem.taxRate = lineTaxRate;
        lineItem.taxAmount = lineTaxAmount;
        detailedLineItems.push(lineItem);


        await this.inventoryService.decreaseStock(
          itemDto.productId,
          itemDto.quantity,
          manager,
        );
      }
      
      const tax = totalTax;
      const total = subtotal + tax;
      

      const orgSettings = await this.orgSettingsRepository.findOne({ where: { organizationId } });
      const baseCurrency = orgSettings?.baseCurrency || 'USD';
      let exchangeRate = 1.0;
      const currencyCode = createInvoiceDto.currencyCode || baseCurrency;

      if (currencyCode !== baseCurrency) {
          const rate = await this.exchangeRateRepository.findOne({
              where: { fromCurrency: baseCurrency, toCurrency: currencyCode, date: LessThanOrEqual(new Date(createInvoiceDto.issueDate)) },
              order: { date: 'DESC' }
          });
          if (!rate) {
            throw new BadRequestError('INVOICES.NO_ENCONTRO_TASA_CAMBIO_VALIDA_FECHA_ESPECIFICADA', { currencyCode });
          }
          // `exchange_rates.rate` is stored as units of `toCurrency` per 1 `fromCurrency`
          // (fromCurrency = base, toCurrency = transaction). `Invoice.exchangeRate` is documented as
          // the rate to convert FROM the transaction currency TO the base currency — i.e. base units
          // per 1 transaction unit — so it is the inverse. Multiplying the transaction total by the
          // raw base→transaction rate inflated `totalInBaseCurrency` by rate^2; we invert it here.
          const baseToTransaction = Number(rate.rate);
          if (!Number.isFinite(baseToTransaction) || baseToTransaction <= 0) {
            throw new BadRequestError('INVOICES.TASA_CAMBIO_CONFIGURADA_NO_ES_VALIDA', { currencyCode });
          }
          exchangeRate = 1 / baseToTransaction;
      }

      
      const invoiceNumber = await this.documentSequencesService.getNextNumber(
        organizationId,
        DocumentType.CUSTOMER_INVOICE,
        manager
      );

      const invoice = manager.create(Invoice, {
        ...createInvoiceDto,
        organizationId,
        invoiceNumber,
        // ncfNumber will be set by the fiscal adapter if applicable
        customer,
        customerName: customer.companyName,
        customerAddress: customer.address,
        lineItems: detailedLineItems,
        subtotal,
        tax,
        total,
        balance: total,
        status: InvoiceStatus.PENDING,
        type: InvoiceType.INVOICE,
        currencyCode,
        exchangeRate,
        totalInBaseCurrency: total * exchangeRate,
      });

      // Apply fiscal logic (NCF, etc.) via strategy
      const fiscalAdapter = await this.fiscalAdapterFactory.getAdapter(organizationId);
      await fiscalAdapter.processInvoice(invoice, createInvoiceDto, organizationId, manager);

      const savedInvoice = await manager.save(invoice);
      

      this.eventEmitter.emit('invoice.created', savedInvoice);
      
      this.logger.log(`Factura ${savedInvoice.invoiceNumber} creada exitosamente en ${savedInvoice.currencyCode}.`);
      return savedInvoice;
    });

    // e-CF is transmitted AFTER the sale is committed, so a slow/unreachable DGII never rolls back
    // the invoice. Fire-and-forget: the submission row records the outcome and the reconciler retries
    // anything left in contingency/error.
    this.triggerEcfSubmission(created);
    return created;
  }

  /** Kicks off asynchronous e-CF transmission for an electronic e-NCF (E-series) document. */
  private triggerEcfSubmission(invoice: Invoice): void {
    if (!invoice.ncfNumber || !invoice.ncfNumber.startsWith('E')) return;
    this.ecfSubmissionService
      .submitInvoice(invoice.id, invoice.organizationId)
      .catch((err) =>
        this.logger.error(
          `Fallo al transmitir el e-CF de la factura ${invoice.invoiceNumber}: ${(err as Error).message}`,
        ),
      );
  }

  findAll(organizationId: string): Promise<Invoice[]> {
    return this.invoicesRepository.find({
      where: { organizationId },
      relations: ['customer'],
      order: { issueDate: 'DESC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<Invoice> {
    const invoice = await this.invoicesRepository.findOne({
      where: { id, organizationId },
      relations: ['lineItems', 'lineItems.product', 'customer'],
    });
    if (!invoice) {
      throw new NotFoundError('INVOICES.FACTURA_ID_NO_ENCONTRADA', { id });
    }
    return invoice;
  }
  
  async generateInvoicePdf(
    invoiceId: string,
    organizationId: string,
  ): Promise<Buffer> {
    const invoice = await this.findOne(invoiceId, organizationId);
    const organization = await this.organizationRepository.findOneBy({ id: organizationId });

    if (!organization) {
        throw new NotFoundError('INVOICES.NO_ENCONTRO_INFORMACION_ORGANIZACION');
    }
    if (!this.invoiceTemplate) {
        throw new InternalServerError('INVOICES.PLANTILLA_GENERAR_PDF_NO_ESTA_DISPONIBLE');
    }

    /*
     * An invoice is written in the language of its RECIPIENT.
     *
     * Not the issuer's, and not the language of whoever pressed the button: a Dominican company
     * invoicing a Brazilian customer sends Portuguese. The customer's stated preference wins;
     * otherwise their country decides; otherwise the tenant's own books language. Every date and
     * figure on the page follows the same choice — it used to be `es-DO` for all nineteen markets,
     * so a US tenant's invoice read "15 de enero de 2026" to a customer in Ohio.
     */
    const language =
      matchLanguage(invoice.customer?.preferredLanguage) ??
      languageOfCountry(invoice.customer?.country) ??
      matchLanguage(organization.booksLanguage) ??
      DEFAULT_LANGUAGE;

    const countryCode = (organization.country ?? 'DO').toUpperCase();
    const locale = resolveLocale(language, countryCode);
    const profile = findCountryProfile(countryCode);

    /**
     * Accounting dates are `date` columns: no time, no zone. Formatted in UTC so the calendar
     * date on the page is the one that was stored — converting it into a zone is what renders a
     * 1 January invoice as 31 December.
     */
    const asDate = (value: string | Date): string =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
        new Date(`${String(value).slice(0, 10)}T00:00:00Z`),
      );

    const data = {
        ...invoice,
        organization,
        language,
        locale,
        // The country's own name for its tax identifier and its consumption tax, rather than the
        // Dominican "RNC" and a generic "Impuestos" printed on every market's documents.
        taxIdLabel: profile?.taxId.label ?? 'ID',
        taxLabel: principalTaxName(countryCode),
        issueDate: asDate(invoice.issueDate),
        dueDate: asDate(invoice.dueDate),
    };

    const htmlContent = this.invoiceTemplate(data);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    

    const pdfUint8Array = await page.pdf({ format: 'A4', printBackground: true });
    const pdfBuffer = Buffer.from(pdfUint8Array);


    await browser.close();
    return pdfBuffer;
  }

  async createCreditNote(
    dto: CreateCreditNoteDto,
    organizationId: string,
  ): Promise<Invoice> {
    const created = await this.dataSource.transaction(async (manager) => {
        const { invoiceId, items } = dto;
        const originalInvoice = await manager.findOne(Invoice, {
            where: { id: invoiceId, organizationId },
            relations: ['lineItems', 'lineItems.product'],
        });
        
        if (!originalInvoice) {
            throw new NotFoundError('INVOICES.FACTURA_ORIGINAL_ID_NO_ENCONTRADA', { invoiceId });
        }
        if (
            originalInvoice.status === InvoiceStatus.VOID
        ) {
            throw new BadRequestError('INVOICES.FACTURA_YA_HA_SIDO_ANULADA');
        }
        
        // If items are provided, this is a partial credit note. 
        // We need to validate items against the original invoice.
        // If no items are provided, we assume a full refund (Void).

        let itemsToReturn = [];
        let isFullRefund = false;

        if (!items || items.length === 0) {
            isFullRefund = true;
            itemsToReturn = originalInvoice.lineItems.map(line => ({
                productId: line.product.id,
                quantity: line.quantity,
                originalLine: line
            }));
        } else {
            // Validate and map partial items
            for (const item of items) {
                const originalLine = originalInvoice.lineItems.find(l => l.product.id === item.productId);
                if (!originalLine) {
                    throw new BadRequestError('INVOICES.PRODUCTO_ID_NO_PERTENECE_FACTURA_ORIGINAL', { productId: item.productId });
                }
                if (item.quantity > originalLine.quantity) {
                    throw new BadRequestError('INVOICES.CANTIDAD_DEVOLVER_EXCEDE_CANTIDAD_ORIGINAL_PRODUCTO', { quantity: item.quantity, quantity2: originalLine.quantity, name: originalLine.product.name });
                }
                itemsToReturn.push({
                    productId: item.productId,
                    quantity: item.quantity,
                    originalLine: originalLine
                });
            }
        }

        // Calculate totals for the credit note
        let cnSubtotal = 0;
        let cnTax = 0;
        const cnLineItems: InvoiceLineItem[] = [];

        for (const item of itemsToReturn) {
            const originalLine = item.originalLine;
            const quantity = item.quantity;
            const price = originalLine.price;
            
            // Recalculate tax based on original tax rate
            const lineTotal = price * quantity;
            const lineTax = lineTotal * (originalLine.taxRate || 0); // Use 0 if taxRate is missing (backward compatibility)

            cnSubtotal += lineTotal;
            cnTax += lineTax;

            const newLine = manager.create(InvoiceLineItem, {
                product: originalLine.product,
                description: originalLine.description,
                quantity: quantity,
                price: price,
                taxRate: originalLine.taxRate,
                taxAmount: lineTax
            });
            cnLineItems.push(newLine);
        }

        const cnTotal = cnSubtotal + cnTax;


        const creditNoteNumber = await this.documentSequencesService.getNextNumber(
            organizationId,
            DocumentType.CREDIT_NOTE,
            manager
        );

        const creditNote = manager.create(Invoice, {
            organizationId,
            invoiceNumber: creditNoteNumber,
            // ncfNumber handled by adapter
            originalInvoiceId: originalInvoice.id,
            status: InvoiceStatus.CREDIT_NOTE,
            type: InvoiceType.CREDIT_NOTE,
            customer: originalInvoice.customer,
            customerId: originalInvoice.customerId,
            customerName: originalInvoice.customerName,
            customerAddress: originalInvoice.customerAddress,
            issueDate: new Date().toISOString(), // Credit note date is now
            dueDate: new Date().toISOString(),
            currencyCode: originalInvoice.currencyCode,
            exchangeRate: originalInvoice.exchangeRate,
            
            // Negative amounts
            subtotal: -cnSubtotal,
            tax: -cnTax,
            total: -cnTotal,
            totalInBaseCurrency: -cnTotal * originalInvoice.exchangeRate,
            
            balance: 0,
            lineItems: cnLineItems,
            notes: dto.reason || `Nota de crédito para factura ${originalInvoice.invoiceNumber}`
        });

        // Apply fiscal logic via strategy
        const fiscalAdapter = await this.fiscalAdapterFactory.getAdapter(organizationId);
        await fiscalAdapter.processCreditNote(creditNote, originalInvoice, organizationId, manager);

        const savedCreditNote = await manager.save(creditNote);

        // Update inventory
        for (const item of itemsToReturn) {
            await this.inventoryService.increaseStock(
                item.productId,
                item.quantity,
                manager,
            );
        }

        // If full refund, mark original as VOID. Otherwise, update its status or just leave it.
        // Usually, for partial refunds, the original invoice remains processed, but the balance might be adjusted if it wasn't paid.
        // But here we are just creating a Credit Note document.
        // If it was a full refund, we explicitly set to VOID as per previous logic.
        if (isFullRefund) {
             originalInvoice.status = InvoiceStatus.VOID;
             originalInvoice.balance = 0;
             await manager.save(originalInvoice);
        } else {
             // For partial, we might want to ensure the invoice reflects that a CN exists?
             // Since we have a 'CREDIT_NOTE' status in the enum, maybe we should use that only for the CN document itself (which we are doing).
             // The original invoice status might not need to change if it was already PAID or PENDING.
             // However, strictly speaking, if we return goods, we might want to update the balance of the customer. 
             // But the invoice balance usually reflects payment.
             // Let's keep it simple: Only update original status if full refund.
        }


        this.eventEmitter.emit('invoice.credit-note-created', {
            originalInvoice,
            creditNote: savedCreditNote,
        });

        this.logger.log(`Nota de crédito ${savedCreditNote.invoiceNumber} creada para factura ${originalInvoice.invoiceNumber}.`);
        return savedCreditNote;
    });

    this.triggerEcfSubmission(created);
    return created;
  }

  async registerPayment(
    invoiceId: string,
    amount: number,
    organizationId: string,
  ): Promise<Invoice> {
    throw new BadRequestError('INVOICES.ESTE_ENDPOINT_ESTA_OBSOLETO_CREACION_PAGOS_AHORA');
  }

  private async getOrgAccountingConfig(organizationId: string): Promise<OrganizationSettings> {

    const settings = await this.orgSettingsRepository.findOne({ where: { organizationId } });
    if (!settings || !settings.defaultAccountsReceivableId || !settings.defaultSalesRevenueId || !settings.defaultSalesTaxId) {
      throw new BadRequestError('INVOICES.CONFIGURACION_CUENTAS_AUTOMATICAS_ESTA_ORGANIZACION_ES_INCOMPLETA');
    }

    return settings;
  }
}