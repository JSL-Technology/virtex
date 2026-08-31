
import { Injectable } from '@nestjs/common';
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
import { BadRequestError, InternalServerError, NotFoundError } from '../i18n/localized.exception';

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
        if (!customer) throw new NotFoundError('CUSTOMERS.CLIENTE_NO_ENCONTRADO');
        
        const defaultLedger = await queryRunner.manager.findOneBy(Ledger, { organizationId, isDefault: true });
        if (!defaultLedger) {
            throw new BadRequestError('CUSTOMERS.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
        }

        const invoiceIds = lines.map(l => l.invoiceId);
        const invoices = await queryRunner.manager.find(Invoice, { where: { id: In(invoiceIds), customerId } });
        if (invoices.length !== invoiceIds.length) {
            throw new BadRequestError('CUSTOMERS.MAS_FACTURAS_NO_SON_VALIDAS_NO_PERTENECEN');
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
                throw new NotFoundError('CUSTOMERS.FACTURA_ID_NO_ENCONTRADA_LOTE', { invoiceId: line.invoiceId });
            }

            if (line.amount > invoice.balance) {
                throw new BadRequestError('CUSTOMERS.MONTO_PAGO_FACTURA_EXCEDE_SALDO_PENDIENTE', { invoiceNumber: invoice.invoiceNumber, amount: line.amount, balance: invoice.balance });
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
            throw new BadRequestError('CUSTOMERS.CUENTA_COBRAR_DEFECTO_NO_ESTA_CONFIGURADA_ORGANIZACION');
        }
        
        const paymentJournal = await queryRunner.manager.findOneBy(Journal, { organizationId, code: 'COBROS' });
        if (!paymentJournal) {
            throw new BadRequestError('CUSTOMERS.DIARIO_COBROS_COBROS_NO_ENCONTRADO_FAVOR_CREE');
        }

        if (!queryRunner) {
          throw new InternalServerError('CUSTOMERS.NO_PUDO_OBTENER_QUERY_RUNNER_TRANSACCION');
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