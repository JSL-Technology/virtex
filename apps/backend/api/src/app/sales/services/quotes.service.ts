import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThanOrEqual } from 'typeorm';
import { Quote, QuoteStatus } from '../entities/quote.entity';
import { CreateQuoteDto } from '../dto/create-quote.dto';
import { CustomersService } from '../../customers/customers.service';
import { DocumentSequencesService } from '../../shared/document-sequences/document-sequences.service';
import { DocumentType } from '../../shared/document-sequences/entities/document-sequence.entity';
import { InvoicesService } from '../../invoices/invoices.service';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { ExchangeRate } from '../../currencies/entities/exchange-rate.entity';
import { BadRequestError, ConflictError, NotFoundError } from '../../i18n/localized.exception';

@Injectable()
export class QuotesService {
  constructor(
    @InjectRepository(Quote)
    private readonly quoteRepository: Repository<Quote>,

    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    @InjectRepository(ExchangeRate)
    private readonly exchangeRateRepository: Repository<ExchangeRate>,
    private readonly dataSource: DataSource,

    private readonly customersService: CustomersService,
    private readonly documentSequencesService: DocumentSequencesService,
    private readonly invoicesService: InvoicesService,
  ) {}

  async create(dto: CreateQuoteDto, organizationId: string, owner: any): Promise<Quote> {
    return this.dataSource.transaction(async (manager) => {
        const customer = await this.customersService.findOne(dto.customerId, organizationId);
        

        const orgSettings = await this.orgSettingsRepository.findOne({ where: { organizationId } });
        const baseCurrency = orgSettings?.baseCurrency || 'USD';
        const currencyCode = dto.currencyCode || baseCurrency;
        let exchangeRate = 1.0;

        if (currencyCode !== baseCurrency) {
            const rate = await this.exchangeRateRepository.findOne({
                where: { fromCurrency: baseCurrency, toCurrency: currencyCode, date: LessThanOrEqual(new Date(dto.issueDate)) },
                order: { date: 'DESC' }
            });
            if (!rate) {
              throw new BadRequestError('SALES.NO_ENCONTRO_TASA_CAMBIO_VALIDA_FECHA_ESPECIFICADA', { currencyCode });
            }
            // Stored as units of `toCurrency` per 1 `fromCurrency`; the document needs the inverse.
            const baseToTransaction = Number(rate.rate);
            if (!Number.isFinite(baseToTransaction) || baseToTransaction <= 0) {
              throw new BadRequestError('SALES.TASA_CAMBIO_CONFIGURADA_NO_ES_VALIDA', { currencyCode });
            }
            exchangeRate = 1 / baseToTransaction;
        }


        // A quote is not an invoice: drawing its number from the CUSTOMER_INVOICE sequence
        // consumed invoice numbers for documents that may never be invoiced, leaving gaps in the
        // commercial numbering that a tenant has to explain.
        const quoteNumber = await this.documentSequencesService.getNextNumber(
          organizationId,
          DocumentType.QUOTE,
          manager,
        );
        const subtotal = dto.lines.reduce((acc, line) => acc + line.quantity * line.unitPrice, 0);
        const total = subtotal;
        
        const quote = manager.create(Quote, {
          ...dto,
          organizationId,
          owner,
          customer,
          quoteNumber,
          subtotal,
          total,
          lines: dto.lines,

          currencyCode,
          exchangeRate,
          totalInBaseCurrency: total * exchangeRate,
        });

        return manager.save(quote);
    });
  }

  /**
   * Turn an accepted quote into an invoice.
   *
   * ## Three defects this closes
   *
   * 1. **It could not run at all.** `SalesModule` was not imported by `AppModule` or by any other
   *    module, so `QuotesController` was never registered and this endpoint did not exist in the
   *    deployed application — `app.get(QuotesService)` threw `UnknownElementException`.
   * 2. **It read a relation it had not loaded.** `findOneBy` does not load `lines.product`, which is
   *    not eager, so `line.product.id` dereferenced `undefined` on the first line.
   * 3. **It dropped the tax.** The mapped lines carried no tax treatment, so every converted quote
   *    was invoiced at 0 % — the ITBIS simply vanished between the quote and the comprobante.
   *
   * The invoice is created as a DRAFT: converting a quote is a commercial step, and issuing is a
   * fiscal one that consumes an e-NCF. The caller issues it when they mean to.
   */
  async convertToInvoice(
    quoteId: string,
    organizationId: string,
    options: { issue?: boolean } = {},
  ): Promise<Invoice> {
    const quote = await this.quoteRepository.findOne({
      where: { id: quoteId, organizationId },
      relations: ['customer', 'lines', 'lines.product'],
    });
    if (!quote) throw new NotFoundError('SALES.COTIZACION_NO_ENCONTRADA');
    if (quote.status === QuoteStatus.INVOICED) {
      throw new ConflictError('SALES.COTIZACION_YA_FUE_FACTURADA', { quoteNumber: quote.quoteNumber });
    }
    if (quote.status !== QuoteStatus.ACCEPTED) {
      throw new BadRequestError('SALES.SOLO_PUEDEN_FACTURAR_COTIZACIONES_ACEPTADAS');
    }
    if (!quote.lines?.length) {
      throw new BadRequestError('SALES.COTIZACION_NO_TIENE_LINEAS_FACTURAR');
    }

    const today = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 30 * 24 * 3600_000).toISOString().split('T')[0];

    const invoice = await this.invoicesService.create(
      {
        customerId: quote.customer.id,
        issueDate: today,
        dueDate,
        currencyCode: quote.currencyCode,
        notes: `Generada desde la cotización ${quote.quoteNumber}.`,
        // Left as a draft unless the caller asks otherwise: a quote becoming an invoice should not
        // silently consume fiscal numbering.
        issue: options.issue === true,
        lineItems: quote.lines.map((line) => ({
          productId: line.product?.id,
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          // Tax treatment and rate come from the catalogue, exactly as on a directly created
          // invoice — which is what stops the tax from disappearing in the conversion.
        })),
      },
      organizationId,
    );

    quote.status = QuoteStatus.INVOICED;
    await this.quoteRepository.save(quote);

    return invoice;
  }

  findAll(organizationId: string) {
    return this.quoteRepository.find({ where: { organizationId }});
  }
}