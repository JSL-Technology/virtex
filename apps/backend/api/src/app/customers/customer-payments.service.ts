
import { Injectable, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { CustomerPayment } from './entities/customer-payment.entity';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto';
import { Customer } from './entities/customer.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';

@Injectable()
export class CustomerPaymentsService {
  constructor(
    @InjectRepository(CustomerPayment)
    private customerPaymentRepository: Repository<CustomerPayment>,
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    @InjectRepository(OrganizationSettings)
    private orgSettingsRepository: Repository<OrganizationSettings>,
    private journalEntriesService: JournalEntriesService,
    private dataSource: DataSource,
  ) {}

  async create(dto: CreateCustomerPaymentDto, organizationId: string): Promise<CustomerPayment> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        const { customerId, bankAccountId, lines, paymentDate, reference } = dto;

        const customer = await queryRunner.manager.findOneBy(Customer, { id: customerId, organizationId });
        if (!customer) throw new NotFoundException('Cliente no encontrado.');
        
        const defaultLedger = await queryRunner.manager.findOneBy(Ledger, { organizationId, isDefault: true });
        if (!defaultLedger) {
            throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
        }

        const invoiceIds = lines.map(l => l.invoiceId);
        const invoices = await queryRunner.manager.find(Invoice, { where: { id: In(invoiceIds), customerId } });
        if (invoices.length !== invoiceIds.length) {
            throw new BadRequestException('Una o más facturas no son válidas o no pertenecen al cliente especificado.');
        }

        const totalPaymentAmount = lines.reduce((sum, line) => sum + line.amount, 0);
        
        const paymentDateObj = new Date(paymentDate);

        const payment = queryRunner.manager.create(CustomerPayment, {
            organizationId,
            customerId,
            paymentDate: paymentDateObj,
            bankAccountId,
            reference,
            totalAmount: totalPaymentAmount,
            lines: lines,
        });
        
        const savedPayment = await queryRunner.manager.save(payment);

        for (const line of lines) {
            const invoice = invoices.find(inv => inv.id === line.invoiceId);
            if (!invoice) {
                throw new NotFoundException(`Factura con ID ${line.invoiceId} no encontrada en el lote.`);
            }

            if (line.amount > invoice.balance) {
                throw new BadRequestException(`El monto del pago para la factura ${invoice.invoiceNumber} (${line.amount}) excede su saldo pendiente (${invoice.balance}).`);
            }

            invoice.balance -= line.amount;
            if (invoice.balance <= 0.005) {
                invoice.status = InvoiceStatus.PAID;
                invoice.balance = 0;
            } else {
                invoice.status = InvoiceStatus.PARTIALLY_PAID;
            }
            await queryRunner.manager.save(invoice);
        }
        
        const settings = await queryRunner.manager.findOneBy(OrganizationSettings, { organizationId });
        if (!settings || !settings.defaultAccountsReceivableId) {
            throw new BadRequestException('La cuenta por cobrar por defecto no está configurada para la organización.');
        }
        
        const paymentJournal = await queryRunner.manager.findOneBy(Journal, { organizationId, code: 'COBROS' });
        if (!paymentJournal) {
            throw new BadRequestException('Diario de Cobros (COBROS) no encontrado. Por favor, cree un diario con este código.');
        }

        if (!queryRunner) {
          throw new InternalServerErrorException('No se pudo obtener el Query Runner de la transacción.');
        }
        
        const entryDto: CreateJournalEntryDto = {
            date: paymentDateObj.toISOString(),
            description: `Recibo de pago #${savedPayment.id.substring(0,8)} de ${customer.companyName}`,
            journalId: paymentJournal.id,
            lines: [
                { 
                  accountId: bankAccountId, 
                  debit: totalPaymentAmount, 
                  credit: 0, 
                  description: 'Ingreso a banco',
                  valuations: [{
                    ledgerId: defaultLedger.id,
                    debit: totalPaymentAmount,
                    credit: 0
                  }]
                },
                { 
                  accountId: settings.defaultAccountsReceivableId, 
                  debit: 0, 
                  credit: totalPaymentAmount, 
                  description: 'Cancelación de cuenta por cobrar cliente',
                  valuations: [{
                    ledgerId: defaultLedger.id,
                    debit: 0,
                    credit: totalPaymentAmount
                  }]
                }
            ]
        };

        await this.journalEntriesService.createWithQueryRunner(queryRunner, entryDto, organizationId);

        await queryRunner.commitTransaction();
        return savedPayment;
    } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
    } finally {
        await queryRunner.release();
    }
  }
}