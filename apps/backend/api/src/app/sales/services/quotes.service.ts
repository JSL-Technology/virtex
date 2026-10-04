import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { Quote, QuoteStatus } from '../entities/quote.entity';
import { QuoteLine } from '../entities/quote-line.entity';
import { CreateQuoteDto, UpdateQuoteDto } from '../dto/create-quote.dto';
import { CustomersService } from '../../customers/customers.service';
import { DocumentSequencesService } from '../../shared/document-sequences/document-sequences.service';
import { DocumentType } from '../../shared/document-sequences/entities/document-sequence.entity';
import { InvoicesService } from '../../invoices/invoices.service';
import { CreateInvoiceDto } from '../../invoices/dto/create-invoice.dto';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { ComputedDocument } from '../../invoices/sales-tax.engine';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { ExchangeRateResolver } from '../../currencies/exchange-rate-resolver.service';
import { BadRequestError, ConflictError, NotFoundError } from '../../i18n/localized.exception';

/** A quote as read: the row plus whether its validity has run out. */
export type QuoteView = Quote & { expired: boolean };

const today = (): string => new Date().toISOString().slice(0, 10);
const isoDate = (value: Date | string): string => String(value instanceof Date ? value.toISOString() : value).slice(0, 10);

/**
 * Sales quotes, as a document with a lifecycle.
 *
 * DRAFT → SENT → ACCEPTED → INVOICED, with REJECTED (the customer said no, and why) and CANCELLED
 * (withdrawn before an answer) as the other ends. A quote past its validity date reads as expired:
 * it can still be rejected or cancelled, not accepted — the customer is accepting a price the
 * company no longer promised; it is duplicated with new dates instead.
 *
 * QA M-09: «Nueva cotización» led to «módulo en construcción». The API could create a quote and
 * convert an ACCEPTED one, and nothing could make a quote accepted, so conversion was unreachable.
 * The totals carried no tax, so the price a customer accepted grew by the ITBIS on the invoice.
 * Totals are now computed by the invoice's own engine (`InvoicesService.preview`): the quote shows
 * what the invoice will charge, to the cent.
 */
@Injectable()
export class QuotesService {
  constructor(
    @InjectRepository(Quote)
    private readonly quoteRepository: Repository<Quote>,

    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    private readonly exchangeRateResolver: ExchangeRateResolver,
    private readonly dataSource: DataSource,

    private readonly customersService: CustomersService,
    private readonly documentSequencesService: DocumentSequencesService,
    private readonly invoicesService: InvoicesService,
  ) {}

  /** What the quote comes to, without saving: the invoice engine on the quote's lines. */
  async preview(dto: CreateQuoteDto, organizationId: string): Promise<ComputedDocument> {
    this.assertDates(dto);
    return this.invoicesService.preview(this.asInvoice(dto), organizationId);
  }

  async create(dto: CreateQuoteDto, organizationId: string, owner: { id: string }): Promise<Quote> {
    this.assertDates(dto);
    const computed = await this.invoicesService.preview(this.asInvoice(dto), organizationId);
    return this.dataSource.transaction(async (manager) => {
      const customer = await this.customersService.findOne(dto.customerId, organizationId);
      const { currencyCode, exchangeRate } = await this.currencyFor(dto, organizationId, manager);

      // A quote is not an invoice: drawing its number from the CUSTOMER_INVOICE sequence consumed
      // invoice numbers for documents that may never be invoiced.
      const quoteNumber = await this.documentSequencesService.getNextNumber(organizationId, DocumentType.QUOTE, manager);

      const quote = manager.create(Quote, {
        organizationId,
        owner: { id: owner.id },
        customer,
        opportunity: dto.opportunityId ? { id: dto.opportunityId } : undefined,
        quoteNumber,
        issueDate: dto.issueDate as unknown as Date,
        expiryDate: dto.expiryDate as unknown as Date,
        currencyCode,
        exchangeRate,
        status: QuoteStatus.DRAFT,
      } as Partial<Quote>);
      this.applyComputation(quote, dto, computed, exchangeRate);
      return manager.save(quote);
    });
  }

  async update(id: string, dto: UpdateQuoteDto, organizationId: string): Promise<Quote> {
    this.assertDates(dto);
    const computed = await this.invoicesService.preview(this.asInvoice(dto), organizationId);
    return this.dataSource.transaction(async (manager) => {
      const quote = await this.load(id, organizationId, manager, true);
      if (quote.status !== QuoteStatus.DRAFT) {
        throw new ConflictError('sales.quote_not_editable', { quoteNumber: quote.quoteNumber });
      }
      const customer = await this.customersService.findOne(dto.customerId, organizationId);
      const { currencyCode, exchangeRate } = await this.currencyFor(dto, organizationId, manager);

      // The lines are the document: replaced whole, in the order written.
      await manager.delete(QuoteLine, { quote: { id: quote.id } });
      Object.assign(quote, {
        customer,
        opportunity: dto.opportunityId ? { id: dto.opportunityId } : null,
        issueDate: dto.issueDate,
        expiryDate: dto.expiryDate,
        currencyCode,
        exchangeRate,
      });
      this.applyComputation(quote, dto, computed, exchangeRate);
      return manager.save(quote);
    });
  }

  async findAll(organizationId: string, filters: { status?: string } = {}): Promise<QuoteView[]> {
    const statuses = Object.values(QuoteStatus) as string[];
    const where: Record<string, unknown> = { organizationId };
    if (filters.status && statuses.includes(filters.status)) where['status'] = filters.status;
    const quotes = await this.quoteRepository.find({
      where,
      order: { issueDate: 'DESC', quoteNumber: 'DESC' },
    });
    return quotes.map((quote) => this.view(quote));
  }

  async findOne(id: string, organizationId: string): Promise<QuoteView> {
    return this.view(await this.load(id, organizationId, this.dataSource.manager, true));
  }

  /** The customer has it. Nothing is e-mailed from here; this records that it went out. */
  async markSent(id: string, organizationId: string): Promise<QuoteView> {
    return this.transition(id, organizationId, [QuoteStatus.DRAFT], (quote) => {
      quote.status = QuoteStatus.SENT;
      quote.sentAt = new Date();
    });
  }

  /**
   * The customer said yes. From DRAFT as well as SENT: a quote agreed across the counter was never
   * «sent». Refused once expired: the customer is accepting a price no longer promised.
   */
  async accept(id: string, organizationId: string): Promise<QuoteView> {
    return this.transition(id, organizationId, [QuoteStatus.DRAFT, QuoteStatus.SENT], (quote) => {
      if (isoDate(quote.expiryDate) < today()) {
        throw new ConflictError('sales.quote_expired_cannot_accept', { quoteNumber: quote.quoteNumber });
      }
      quote.status = QuoteStatus.ACCEPTED;
      quote.acceptedAt = new Date();
    });
  }

  /** The customer said no. The reason is what sales needs next time. */
  async reject(id: string, reason: string, organizationId: string): Promise<QuoteView> {
    const text = reason?.trim();
    if (!text) throw new BadRequestError('sales.quote_rejection_reason_required');
    return this.transition(id, organizationId, [QuoteStatus.DRAFT, QuoteStatus.SENT, QuoteStatus.ACCEPTED], (quote) => {
      quote.status = QuoteStatus.REJECTED;
      quote.rejectedAt = new Date();
      quote.rejectionReason = text;
    });
  }

  /** Withdrawn before an answer. Kept, numbered: a gap in the numbering is not explained by absence. */
  async cancel(id: string, reason: string | undefined, organizationId: string): Promise<QuoteView> {
    return this.transition(id, organizationId, [QuoteStatus.DRAFT, QuoteStatus.SENT], (quote) => {
      quote.status = QuoteStatus.CANCELLED;
      quote.rejectionReason = reason?.trim() || null;
    });
  }

  /**
   * A new draft from an existing quote: same customer and lines, dated today, valid for as long
   * as the original was. How an expired or rejected quote is revised.
   */
  async duplicate(id: string, organizationId: string, owner: { id: string }): Promise<Quote> {
    const source = await this.load(id, organizationId, this.dataSource.manager, true);
    const validityDays = Math.max(
      1,
      Math.round((Date.parse(isoDate(source.expiryDate)) - Date.parse(isoDate(source.issueDate))) / 86_400_000),
    );
    const issueDate = today();
    const expiryDate = new Date(Date.parse(issueDate) + validityDays * 86_400_000).toISOString().slice(0, 10);
    return this.create(
      {
        customerId: source.customer.id,
        issueDate,
        expiryDate,
        currencyCode: source.currencyCode,
        documentDiscountRate: Number(source.documentDiscountRate) || undefined,
        notes: source.notes ?? undefined,
        lines: this.sortedLines(source).map((line) => ({
          productId: line.product?.id,
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountRate: Number(line.discountRate) || undefined,
        })),
      },
      organizationId,
      owner,
    );
  }

  /**
   * Turn an accepted quote into an invoice.
   *
   * The invoice is created as a DRAFT: converting a quote is a commercial step, and issuing is a
   * fiscal one that consumes an e-NCF. Its lines carry the quote's prices and discounts; the tax
   * comes from the catalogue exactly as on a directly created invoice.
   *
   * The quote is claimed first (ACCEPTED → INVOICED in one conditional UPDATE) so two clicks, or two
   * people, cannot make two invoices from it; if the invoice cannot be created the claim is undone.
   */
  async convertToInvoice(quoteId: string, organizationId: string, options: { issue?: boolean } = {}): Promise<Invoice> {
    const quote = await this.load(quoteId, organizationId, this.dataSource.manager, true);
    if (quote.status === QuoteStatus.INVOICED) {
      throw new ConflictError('sales.quote_quote_number_has_already_invoiced', { quoteNumber: quote.quoteNumber });
    }
    if (quote.status !== QuoteStatus.ACCEPTED) {
      throw new BadRequestError('sales.only_accepted_quotes_can_invoiced');
    }
    if (!quote.lines?.length) {
      throw new BadRequestError('sales.quote_has_no_lines_invoice');
    }

    const claimed = await this.quoteRepository.update(
      { id: quote.id, organizationId, status: QuoteStatus.ACCEPTED },
      { status: QuoteStatus.INVOICED },
    );
    if (!claimed.affected) {
      throw new ConflictError('sales.quote_quote_number_has_already_invoiced', { quoteNumber: quote.quoteNumber });
    }

    try {
      const settings = await this.orgSettingsRepository.findOne({ where: { organizationId } });
      const termDays = quote.customer?.paymentTermDays ?? settings?.defaultPaymentTermDays ?? 30;
      const issueDate = today();
      const dueDate = new Date(Date.parse(issueDate) + Math.max(0, termDays) * 86_400_000).toISOString().slice(0, 10);

      const invoice = await this.invoicesService.create(
        {
          customerId: quote.customer.id,
          issueDate,
          dueDate,
          currencyCode: quote.currencyCode,
          documentDiscountRate: Number(quote.documentDiscountRate) || undefined,
          notes: quote.notes ?? undefined,
          issue: options.issue === true,
          lineItems: this.sortedLines(quote).map((line) => ({
            productId: line.product?.id,
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            discountRate: Number(line.discountRate) || undefined,
          })),
        } as CreateInvoiceDto,
        organizationId,
      );
      await this.quoteRepository.update({ id: quote.id, organizationId }, { invoiceId: invoice.id });
      return invoice;
    } catch (error) {
      await this.quoteRepository.update(
        { id: quote.id, organizationId, status: QuoteStatus.INVOICED },
        { status: QuoteStatus.ACCEPTED },
      );
      throw error;
    }
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────

  private assertDates(dto: CreateQuoteDto): void {
    if (isoDate(dto.expiryDate) < isoDate(dto.issueDate)) {
      throw new BadRequestError('sales.quote_expiry_before_issue');
    }
  }

  private asInvoice(dto: CreateQuoteDto): CreateInvoiceDto {
    return {
      customerId: dto.customerId,
      issueDate: dto.issueDate,
      dueDate: dto.expiryDate,
      currencyCode: dto.currencyCode,
      documentDiscountRate: dto.documentDiscountRate,
      lineItems: dto.lines.map((line) => ({
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate,
      })),
    } as CreateInvoiceDto;
  }

  private applyComputation(quote: Quote, dto: CreateQuoteDto, computed: ComputedDocument, exchangeRate: number): void {
    quote.lines = dto.lines.map((line, index) => {
      const result = computed.lines[index];
      return Object.assign(new QuoteLine(), {
        lineOrder: index,
        product: line.productId ? { id: line.productId } : null,
        description: line.description.trim(),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate ?? 0,
        taxRate: result?.taxRate ?? 0,
        taxAmount: result?.taxAmount ?? 0,
        lineTotal: result?.subtotal ?? 0,
      });
    });
    quote.documentDiscountRate = dto.documentDiscountRate ?? 0;
    quote.notes = dto.notes?.trim() || null;
    quote.subtotal = computed.subtotal;
    quote.discountTotal =
      computed.discountTotal + computed.lines.reduce((sum, line) => sum + (line.discountAmount ?? 0), 0);
    quote.taxTotal = computed.tax + computed.excise;
    quote.total = computed.total;
    quote.totalInBaseCurrency = Math.round(computed.total * exchangeRate * 100) / 100;
  }

  private async currencyFor(
    dto: CreateQuoteDto,
    organizationId: string,
    manager: EntityManager,
  ): Promise<{ currencyCode: string; exchangeRate: number }> {
    const orgSettings = await manager.findOne(OrganizationSettings, { where: { organizationId } });
    const baseCurrency = orgSettings?.baseCurrency || 'USD';
    const currencyCode = dto.currencyCode || baseCurrency;
    if (currencyCode === baseCurrency) return { currencyCode, exchangeRate: 1 };
    // Through the resolver: direct, inverted, or crossed through the dollar, in the direction the
    // document stores — units of base currency per one unit of transaction currency.
    const rateType = await this.exchangeRateResolver.rateTypeFor(organizationId, manager);
    const exchangeRate = await this.exchangeRateResolver.rateFor(currencyCode, baseCurrency, dto.issueDate, manager, rateType);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new BadRequestError('sales.exchange_rate_configured_currency_code_not', { currencyCode });
    }
    return { currencyCode, exchangeRate };
  }

  private async load(id: string, organizationId: string, manager: EntityManager, withLines: boolean): Promise<Quote> {
    const quote = await manager.findOne(Quote, {
      where: { id, organizationId },
      relations: withLines ? ['customer', 'lines', 'lines.product'] : ['customer'],
    });
    if (!quote) throw new NotFoundError('sales.quote_not_found');
    return quote;
  }

  private async transition(
    id: string,
    organizationId: string,
    from: QuoteStatus[],
    apply: (quote: Quote) => void,
  ): Promise<QuoteView> {
    return this.dataSource.transaction(async (manager) => {
      const quote = await this.load(id, organizationId, manager, true);
      if (!from.includes(quote.status)) {
        throw new ConflictError('sales.quote_transition_not_allowed', {
          quoteNumber: quote.quoteNumber,
          status: quote.status,
        });
      }
      apply(quote);
      // Only the header changes; saving the eager lines back is unnecessary and racy.
      const { lines, ...header } = quote;
      await manager.update(Quote, { id: quote.id, organizationId, status: In(from) }, {
        status: header.status,
        sentAt: header.sentAt,
        acceptedAt: header.acceptedAt,
        rejectedAt: header.rejectedAt,
        rejectionReason: header.rejectionReason,
      });
      return this.view({ ...quote, lines } as Quote);
    });
  }

  private sortedLines(quote: Quote): QuoteLine[] {
    return [...(quote.lines ?? [])].sort((a, b) => a.lineOrder - b.lineOrder);
  }

  private view(quote: Quote): QuoteView {
    const expired = [QuoteStatus.DRAFT, QuoteStatus.SENT].includes(quote.status) && isoDate(quote.expiryDate) < today();
    return Object.assign(quote, { lines: this.sortedLines(quote), expired });
  }
}
