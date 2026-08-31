

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource, LessThanOrEqual } from 'typeorm';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';
import { UpdateVendorBillDto } from './dto/update-vendor-bill.dto';
import {
  PaymentBatch,
  PaymentBatchStatus,
} from './entities/payment-batch.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { VendorPayment } from './entities/vendor-payment.entity';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InventoryService } from '../inventory/inventory.service';
import { CreateJournalEntryDto, CreateJournalEntryLineDto } from '../journal-entries/dto/create-journal-entry.dto';
import { WorkflowsService } from '../workflows/workflows.service';
import { DocumentTypeForApproval } from '../workflows/entities/approval-policy.entity';
import { BudgetControlService } from '../budgets/budget-control.service';
import { ExchangeRate } from '../currencies/entities/exchange-rate.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { BadRequestError, ForbiddenError, InternalServerError, NotFoundError } from '../i18n/localized.exception';

@Injectable()
export class AccountsPayableService {
  private readonly logger = new Logger(AccountsPayableService.name);

  constructor(
    @InjectRepository(VendorBill)
    private vendorBillRepository: Repository<VendorBill>,
    @InjectRepository(PaymentBatch)
    private paymentBatchRepository: Repository<PaymentBatch>,
    @InjectRepository(OrganizationSettings)
    private orgSettingsRepository: Repository<OrganizationSettings>,
    @InjectRepository(ExchangeRate)
    private exchangeRateRepository: Repository<ExchangeRate>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly workflowsService: WorkflowsService,
    private readonly budgetControlService: BudgetControlService,
  ) {}

  async create(
    createVendorBillDto: CreateVendorBillDto,
    organizationId: string,
  ): Promise<VendorBill> {
    const { lines, ...billData } = createVendorBillDto;

    const total = lines.reduce((sum, line) => sum + line.total, 0);

    const orgSettings = await this.orgSettingsRepository.findOne({ where: { organizationId } });
    const baseCurrency = orgSettings?.baseCurrency || 'USD';
    let exchangeRate = 1.0;
    const currencyCode = createVendorBillDto.currencyCode || baseCurrency;

    if (currencyCode !== baseCurrency) {
        const rate = await this.exchangeRateRepository.findOne({
            where: { fromCurrency: baseCurrency, toCurrency: currencyCode, date: LessThanOrEqual(new Date(createVendorBillDto.date)) },
            order: { date: 'DESC' }
        });
        if (!rate) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.NO_ENCONTRO_TASA_CAMBIO_VALIDA_FECHA_ESPECIFICADA', { currencyCode });
        }
        exchangeRate = rate.rate;
    }

    const newBill = this.vendorBillRepository.create({
      ...billData,
      organizationId,
      lines,
      total,
      balance: total,
      status: VendorBillStatus.DRAFT,
      currencyCode,
      exchangeRate,
      totalInBaseCurrency: total * exchangeRate,
    });

    const savedBill = await this.vendorBillRepository.save(newBill);
    this.logger.log(`Factura de proveedor ${savedBill.id} creada en estado Borrador.`);
    return savedBill;
  }

  async submitForApproval(billId: string, organizationId: string): Promise<VendorBill> {
    const bill = await this.findOne(billId, organizationId);
    if (bill.status !== VendorBillStatus.DRAFT) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.SOLO_FACTURAS_ESTADO_BORRADOR_PUEDEN_SER_ENVIADAS');
    }

    for (const line of bill.lines) {
        if (line.expenseAccountId) {

            const budgetCheck = await this.budgetControlService.checkBudget(organizationId, line.expenseAccountId, line.total, bill.date);

            if (budgetCheck.isExceeded) {
                throw new ForbiddenError('ACCOUNTS_PAYABLE.CONTROL_PRESUPUESTARIO_FALLIDO', { message: budgetCheck.message });
            }
        }
    }

    const approvalRequest = await this.workflowsService.startApprovalProcess(
      organizationId,
      bill.id,
      DocumentTypeForApproval.VENDOR_BILL,
      bill.totalInBaseCurrency,
    );

    if (approvalRequest) {
      bill.status = VendorBillStatus.PENDING_APPROVAL;
      bill.approvalRequestId = approvalRequest.id;
      this.logger.log(`Factura ${bill.id} enviada a aprobación.`);
    } else {
      bill.status = VendorBillStatus.OPEN;
      this.logger.log(`Factura ${bill.id} aprobada automáticamente (no se requiere flujo).`);
      this.eventEmitter.emit('vendor.bill.approved', bill);
    }
    
    return this.vendorBillRepository.save(bill);
  }

  findAll(organizationId: string): Promise<VendorBill[]> {
    return this.vendorBillRepository.find({ where: { organizationId }, order: { date: 'DESC' }, relations: ['vendor'] });
  }

  async findOne(id: string, organizationId: string): Promise<VendorBill> {
    const bill = await this.vendorBillRepository.findOne({
      where: { id, organizationId },
      relations: ['lines', 'vendor'],
    });
    if (!bill) {
      throw new NotFoundError('ACCOUNTS_PAYABLE.FACTURA_PROVEEDOR_ID_NO_FUE_ENCONTRADA', { id });
    }
    return bill;
  }

  async update(
    id: string,
    updateVendorBillDto: UpdateVendorBillDto,
    organizationId: string,
  ): Promise<VendorBill> {
    const bill = await this.findOne(id, organizationId);
    if (bill.status !== VendorBillStatus.DRAFT) {
        throw new ForbiddenError('ACCOUNTS_PAYABLE.SOLO_PUEDEN_EDITAR_FACTURAS_ESTADO_BORRADOR');
    }
    if(updateVendorBillDto.lines) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.MODIFICACION_LINEAS_FACTURA_EXISTENTE_DEBE_HACERSE_TRAVES');
    }

    const updatedBill = this.vendorBillRepository.merge(
      bill,
      updateVendorBillDto,
    );

    return this.vendorBillRepository.save(updatedBill);
  }

  async voidBill(id: string, organizationId: string, reason: string): Promise<VendorBill> {
    return this.dataSource.transaction(async (manager) => {
        const bill = await manager.findOne(VendorBill, { where: { id, organizationId }, relations: ['lines', 'vendor']});
        if (!bill) {
            throw new NotFoundError('ACCOUNTS_PAYABLE.FACTURA_ANULAR_ID_NO_ENCONTRADA', { id });
        }
        if (bill.status === VendorBillStatus.VOID) {
            throw new BadRequestError('ACCOUNTS_PAYABLE.FACTURA_YA_HA_SIDO_ANULADA');
        }
        if (bill.status === VendorBillStatus.PAID) {
            throw new BadRequestError('ACCOUNTS_PAYABLE.NO_PUEDE_ANULAR_FACTURA_PAGADA_PRIMERO_ANULE');
        }

        if (bill.status === VendorBillStatus.OPEN || bill.status === VendorBillStatus.PARTIALLY_PAID) {
            this.eventEmitter.emit('vendor.bill.voided', bill, reason);
        }

        for (const line of bill.lines) {
            if (line.productId) {
                await this.inventoryService.increaseStock(line.productId, line.quantity, manager);
            }
        }

        bill.status = VendorBillStatus.VOID;
        bill.balance = 0;
        const voidedBill = await manager.save(bill);

        this.logger.log(`Factura ${id} anulada. Razón: ${reason}`);
        return voidedBill;
    });
  }
  
  async remove(id: string, organizationId: string): Promise<void> {
    throw new ForbiddenError('ACCOUNTS_PAYABLE.ELIMINACION_FACTURAS_NO_ESTA_PERMITIDA_USE_FUNCION');
  }

  async createPaymentBatch(
    billIds: string[],
    paymentDate: Date,
    bankAccountId: string,
    organizationId: string,
  ): Promise<PaymentBatch> {
    return this.dataSource.transaction(async (manager) => {
      const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
      if (!settings || !settings.defaultAccountsPayableId) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_CUENTAS_PAGAR_NO_ESTA_CONFIGURADA');
      }
      
      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
      }

      const billsToPay = await manager.findBy(VendorBill, {
        id: In(billIds),
        organizationId,
        status: In([VendorBillStatus.OPEN, VendorBillStatus.PARTIALLY_PAID]),
      });

      if (billsToPay.length === 0) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.NINGUNA_FACTURAS_SELECCIONADAS_ES_VALIDA_PAGO');
      }
      if (billsToPay.length !== billIds.length) {
        this.logger.warn('Algunas facturas no se procesaron en el lote por no ser válidas.');
      }
      
      const totalPaymentAmount = billsToPay.reduce((sum, bill) => sum + bill.balance, 0);

      const paymentJournal = await manager.findOneBy(Journal, { organizationId, code: 'PAGOS' });
      if (!paymentJournal) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.DIARIO_PAGOS_PAGOS_NO_ENCONTRADO');
      }

      const newBatch = manager.create(PaymentBatch, {
        organizationId,
        paymentDate,
        bankAccountId,
        status: PaymentBatchStatus.PROCESSING,
        payments: [],
      });
      const savedBatch = await manager.save(newBatch);

      for (const bill of billsToPay) {
        const vendorPayment = manager.create(VendorPayment, {
          paymentBatch: savedBatch,
          vendorBillId: bill.id,
          date: paymentDate,
          amount: bill.balance, 
        });
        await manager.save(vendorPayment);

        bill.balance = 0;
        bill.status = VendorBillStatus.PAID;
        await manager.save(bill);
      }
      
      if (!manager.queryRunner) {
        throw new InternalServerError('ACCOUNTS_PAYABLE.NO_PUDO_OBTENER_QUERY_RUNNER_TRANSACCION');
      }
      
      const entryDto: CreateJournalEntryDto = {
          date: paymentDate.toISOString(),
          description: `Pago de facturas de proveedores - Lote #${savedBatch.id.substring(0, 8)}`,
          journalId: paymentJournal.id,
          lines: [
            { 
              accountId: settings.defaultAccountsPayableId, 
              debit: totalPaymentAmount, 
              credit: 0, 
              description: 'Cancelación de deuda a proveedores',
              valuations: [{
                ledgerId: defaultLedger.id,
                debit: totalPaymentAmount,
                credit: 0
              }]
            },
            { 
              accountId: bankAccountId, 
              debit: 0, 
              credit: totalPaymentAmount, 
              description: 'Salida de banco por pago a proveedores',
              valuations: [{
                ledgerId: defaultLedger.id,
                debit: 0,
                credit: totalPaymentAmount
              }]
            },
          ],
      };

      await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, entryDto, organizationId);

      savedBatch.status = PaymentBatchStatus.PAID;
      const finalBatch = await manager.save(savedBatch);

      this.eventEmitter.emit('vendor.payment.created', finalBatch);
      this.logger.log(`Lote de pago ${finalBatch.id} creado y procesado exitosamente.`);
      return finalBatch;
    });
  }

  @OnEvent('vendor.bill.approved', { async: true })
  async handleBillApproved(bill: VendorBill) {
    this.logger.log(`Factura ${bill.id} aprobada. Generando asiento contable.`);
    
    await this.dataSource.transaction(async (manager) => {
      const organizationId = bill.organizationId;
      const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
      if (!settings || !settings.defaultAccountsPayableId) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_PAGAR_DEFECTO_NO_ESTA_CONFIGURADA');
      }
      
      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
      }
      
      const purchaseJournal = await manager.findOneBy(Journal, { organizationId, code: 'COMPRAS' });
      if (!purchaseJournal) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.DIARIO_COMPRAS_COMPRAS_NO_ENCONTRADO');
      }

      const journalLines: CreateJournalEntryLineDto[] = [];
      for (const line of bill.lines) {
        let accountId: string;
        let description: string;

        if (line.productId) {
            if(!settings.defaultInventoryId) {
                throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_INVENTARIO_DEFECTO_NO_ESTA_CONFIGURADA');
            }
            accountId = settings.defaultInventoryId;
            description = `Compra de: ${line.product}`;
        } else {
            if (!line.expenseAccountId) {
                throw new BadRequestError('ACCOUNTS_PAYABLE.LINEA_NO_ES_INVENTARIO_REQUIERE_CUENTA_GASTO', { product: line.product });
            }
            accountId = line.expenseAccountId;
            description = line.product;
        }

        journalLines.push({ 
          accountId: accountId, 
          debit: line.total, 
          credit: 0, 
          description: description,
          valuations: [{
            ledgerId: defaultLedger.id,
            debit: line.total,
            credit: 0
          }]
        });
      }

      journalLines.push({
        accountId: settings.defaultAccountsPayableId,
        debit: 0,
        credit: bill.total,
        description: `Factura de proveedor: ${bill.vendor.name}`,
        valuations: [{
          ledgerId: defaultLedger.id,
          debit: 0,
          credit: bill.total
        }]
      });
      
      if (!manager.queryRunner) {
        throw new InternalServerError('ACCOUNTS_PAYABLE.NO_PUDO_OBTENER_QUERY_RUNNER_TRANSACCION');
      }
      
      const entryDto: CreateJournalEntryDto = {
          date: bill.date.toISOString(),
          description: `Registro de factura de proveedor #${bill.id.substring(0, 8)}`,
          journalId: purchaseJournal.id,
          lines: journalLines,
      };

      await this.journalEntriesService.createWithQueryRunner(manager.queryRunner, entryDto, organizationId);

      this.logger.log(`Asiento contable para factura ${bill.id} creado exitosamente.`);
    }).catch(error => {
        this.logger.error(`Fallo al crear asiento para factura aprobada ${bill.id}: ${error.message}`, error.stack);
    });
  }
}