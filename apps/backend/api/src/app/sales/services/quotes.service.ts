import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThanOrEqual } from 'typeorm';
import { Quote, QuoteStatus } from '../entities/quote.entity';
import { CreateQuoteDto } from '../dto/create-quote.dto';
import { CustomersService } from '../customers/customers.service';
import { DocumentSequencesService } from '../shared/document-sequences/document-sequences.service';
import { DocumentType } from '../shared/document-sequences/entities/document-sequence.entity';
import { InvoicesService } from '../invoices/invoices.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';

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
              throw new BadRequestException(`No se encontró una tasa de cambio válida para ${currencyCode} en la fecha especificada.`);
            }
            exchangeRate = rate.rate;
        }


        const quoteNumber = await this.documentSequencesService.getNextNumber(organizationId, DocumentType.CUSTOMER_INVOICE, manager);
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

  async convertToInvoice(quoteId: string, organizationId: string): Promise<any> {
    const quote = await this.quoteRepository.findOneBy({ id: quoteId, organizationId });
    if (!quote) throw new NotFoundException('Cotización no encontrada.');
    if (quote.status !== QuoteStatus.ACCEPTED) throw new BadRequestException('Solo se pueden facturar cotizaciones aceptadas.');


    const invoiceDto = {
      customerId: quote.customer.id,
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(new Date().setDate(new Date().getDate() + 30)).toISOString().split('T')[0],
      currencyCode: quote.currencyCode,
      lineItems: quote.lines.map(line => ({
        productId: line.product.id,
        description: line.description,
        quantity: line.quantity,
        price: line.unitPrice,
      })),
    };



    const createdInvoice = await this.invoicesService.create(invoiceDto, organizationId);
    
    quote.status = QuoteStatus.INVOICED;
    await this.quoteRepository.save(quote);
    
    return createdInvoice;
  }
  
  findAll(organizationId: string) {
    return this.quoteRepository.find({ where: { organizationId }});
  }
}