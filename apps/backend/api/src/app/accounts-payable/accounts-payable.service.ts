

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
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
          throw new BadRequestException(`No se encontró una tasa de cambio válida para ${currencyCode} en la fecha especificada.`);
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
        throw new BadRequestException('Solo las facturas en estado borrador pueden ser enviadas para aprobación.');
    }

    for (const line of bill.lines) {
        if (line.expenseAccountId) {

            const budgetCheck = await this.budgetControlService.checkBudget(organizationId, line.expenseAccountId, line.total, bill.date);

            if (budgetCheck.isExceeded) {
                throw new ForbiddenException(`Control presupuestario fallido: ${budgetCheck.message}`);
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
      throw new NotFoundException(`La factura de proveedor con ID "${id}" no fue encontrada.`);
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
        throw new ForbiddenException("Solo se pueden editar facturas en estado 'Borrador'.");
    }
    if(updateVendorBillDto.lines) {
        throw new BadRequestException("La modificación de las líneas de una factura existente debe hacerse a través de notas de crédito/débito.");
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
            throw new NotFoundException(`Factura a anular con ID "${id}" no encontrada.`);
        }
        if (bill.status === VendorBillStatus.VOID) {
            throw new BadRequestException('La factura ya ha sido anulada.');
        }
        if (bill.status === VendorBillStatus.PAID) {
            throw new BadRequestException('No se puede anular una factura pagada. Primero anule el pago.');
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
    throw new ForbiddenException('La eliminación de facturas no está permitida. Use la función de "Anular".');
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
        throw new BadRequestException('La cuenta de Cuentas por Pagar no está configurada.');
      }
      
      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
        throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
      }

      const billsToPay = await manager.findBy(VendorBill, {
        id: In(billIds),
        organizationId,
        status: In([VendorBillStatus.OPEN, VendorBillStatus.PARTIALLY_PAID]),
      });

      if (billsToPay.length === 0) {
        throw new BadRequestException('Ninguna de las facturas seleccionadas es válida para el pago.');
      }
      if (billsToPay.length !== billIds.length) {
        this.logger.warn('Algunas facturas no se procesaron en el lote por no ser válidas.');
      }
      
      const totalPaymentAmount = billsToPay.reduce((sum, bill) => sum + bill.balance, 0);

      const paymentJournal = await manager.findOneBy(Journal, { organizationId, code: 'PAGOS' });
      if (!paymentJournal) {
          throw new BadRequestException('Diario de Pagos (PAGOS) no encontrado.');
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
        throw new InternalServerErrorException('No se pudo obtener el Query Runner de la transacción.');
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
        throw new BadRequestException('La cuenta por pagar por defecto no está configurada.');
      }
      
      const defaultLedger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
        throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
      }
      
      const purchaseJournal = await manager.findOneBy(Journal, { organizationId, code: 'COMPRAS' });
      if (!purchaseJournal) {
          throw new BadRequestException('Diario de Compras (COMPRAS) no encontrado.');
      }

      const journalLines: CreateJournalEntryLineDto[] = [];
      for (const line of bill.lines) {
        let accountId: string;
        let description: string;

        if (line.productId) {
            if(!settings.defaultInventoryId) {
                throw new BadRequestException('La cuenta de inventario por defecto no está configurada.');
            }
            accountId = settings.defaultInventoryId;
            description = `Compra de: ${line.product}`;
        } else {
            if (!line.expenseAccountId) {
                throw new BadRequestException(`La línea "${line.product}" no es de inventario y requiere una cuenta de gasto.`);
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
        throw new InternalServerErrorException('No se pudo obtener el Query Runner de la transacción.');
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