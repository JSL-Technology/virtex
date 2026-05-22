

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
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
    private readonly saasService: SaasService
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


  private async compileTemplate() {
    try {
        const templatePath = path.join(__dirname, 'templates', 'invoice.hbs');
        const templateHtml = fs.readFileSync(templatePath, 'utf8');
        
        handlebars.registerHelper('formatNumber', (value) => {
            if (typeof value !== 'number') return value;
            return new Intl.NumberFormat('en-US', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
        });
        handlebars.registerHelper('multiply', (a, b) => (a * b));

        this.invoiceTemplate = handlebars.compile(templateHtml);
    } catch (error) {
        this.logger.error('Error al compilar la plantilla de factura Handlebars', error);
    }
  }

  async create(
    createInvoiceDto: CreateInvoiceDto,
    organizationId: string,
  ): Promise<Invoice> {
    return this.dataSource.transaction(async (manager) => {
      // Enforce SaaS Limit transactionally
      await this.saasService.enforceLimit(manager, organizationId, SaasResource.INVOICES);

      const customer = await this.customersService.findOne(
        createInvoiceDto.customerId,
        organizationId,
      );

      const settings = await this.getOrgAccountingConfig(organizationId);
      // Remove hardcoded defaultTaxRate here. If not provided in DTO, it should be 0 or validated elsewhere.
      // Ideally, the frontend sends the correct tax rate. If missing, we assume 0 or handle it via a tax engine in the future.

      let subtotal = 0;
      let totalTax = 0;
      const detailedLineItems: InvoiceLineItem[] = [];

      for (const itemDto of createInvoiceDto.lineItems) {
        const product = await manager.findOneBy(Product, {
          id: itemDto.productId,
          organizationId,
        });
        if (!product) {
          throw new BadRequestException(
            `Producto con ID "${itemDto.productId}" no encontrado.`,
          );
        }

        const linePrice = itemDto.price ?? product.price;
        const lineTotal = linePrice * itemDto.quantity;
        
        // Calculate tax per line
        // If taxRate is undefined, we default to 0 instead of 0.18 to avoid unexpected taxes.
        const lineTaxRate = itemDto.taxRate !== undefined ? itemDto.taxRate : 0;
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
            throw new BadRequestException(`No se encontró una tasa de cambio válida para ${currencyCode} en la fecha especificada.`);
          }
          exchangeRate = rate.rate;
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
      throw new NotFoundException(`Factura con ID "${id}" no encontrada.`);
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
        throw new NotFoundException('No se encontró la información de la organización.');
    }
    if (!this.invoiceTemplate) {
        throw new InternalServerErrorException('La plantilla para generar PDF no está disponible.');
    }

    const data = {
        ...invoice,
        organization,
        issueDate: new Date(invoice.issueDate).toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }),
        dueDate: new Date(invoice.dueDate).toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }),
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
    return this.dataSource.transaction(async (manager) => {
        const { invoiceId, items } = dto;
        const originalInvoice = await manager.findOne(Invoice, {
            where: { id: invoiceId, organizationId },
            relations: ['lineItems', 'lineItems.product'],
        });
        
        if (!originalInvoice) {
            throw new NotFoundException(`Factura original con ID "${invoiceId}" no encontrada.`);
        }
        if (
            originalInvoice.status === InvoiceStatus.VOID
        ) {
            throw new BadRequestException('La factura ya ha sido anulada.');
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
                    throw new BadRequestException(`El producto con ID ${item.productId} no pertenece a la factura original.`);
                }
                if (item.quantity > originalLine.quantity) {
                    throw new BadRequestException(`La cantidad a devolver (${item.quantity}) excede la cantidad original (${originalLine.quantity}) para el producto ${originalLine.product.name}.`);
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
  }

  async registerPayment(
    invoiceId: string,
    amount: number,
    organizationId: string,
  ): Promise<Invoice> {
    throw new BadRequestException(
      'Este endpoint está obsoleto. La creación de pagos ahora se gestiona a través del endpoint de Recibos de Cliente (/customer-payments) para permitir pagos de múltiples facturas a la vez.',
    );
  }

  private async getOrgAccountingConfig(organizationId: string): Promise<OrganizationSettings> {

    const settings = await this.orgSettingsRepository.findOne({ where: { organizationId } });
    if (!settings || !settings.defaultAccountsReceivableId || !settings.defaultSalesRevenueId || !settings.defaultSalesTaxId) {
      throw new BadRequestException('La configuración de cuentas automáticas para esta organización es incompleta. Faltan cuentas de Cuentas por Cobrar, Ingresos por Ventas o Impuestos sobre Ventas.');
    }

    return settings;
  }
}