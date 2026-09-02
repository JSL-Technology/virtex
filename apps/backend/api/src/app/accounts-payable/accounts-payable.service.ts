import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource, EntityManager } from 'typeorm';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';
import { UpdateVendorBillDto } from './dto/update-vendor-bill.dto';
import { PayVendorBillsDto } from './dto/pay-vendor-bills.dto';
import { PaymentBatch, PaymentBatchStatus } from './entities/payment-batch.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { VendorPayment } from './entities/vendor-payment.entity';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InventoryService } from '../inventory/inventory.service';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../journal-entries/dto/create-journal-entry.dto';
import { WorkflowsService } from '../workflows/workflows.service';
import { DocumentTypeForApproval } from '../workflows/entities/approval-policy.entity';
import { BudgetControlService } from '../budgets/budget-control.service';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { BankAccount } from '../treasury/entities/bank-account.entity';
import { AccountRole } from '../chart-of-accounts/enums/account-enums';
import { ModuleSlug } from '../accounting/entities/accounting-period.entity';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../i18n/localized.exception';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { convert, roundAmount, sumAmounts, toCents } from '../common/money';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';

export interface AgingBucket {
  label: string;
  from: number;
  to: number | null;
  amount: number;
}

export interface AgingRow {
  partyId: string;
  partyName: string;
  current: number;
  buckets: AgingBucket[];
  total: number;
}

/** The standard ageing ladder. Days past due, oldest bucket open-ended. */
const AGING_BUCKETS: { label: string; from: number; to: number | null }[] = [
  { label: '1-30', from: 1, to: 30 },
  { label: '31-60', from: 31, to: 60 },
  { label: '61-90', from: 61, to: 90 },
  { label: '90+', from: 91, to: null },
];

/**
 * Supplier invoices: recording them, approving them, paying them, and ageing what is left.
 *
 * ## What was missing
 *
 * There was no way to pay a bill. `createPaymentBatch` existed but no controller exposed it and
 * nothing called it — dead code — and had it been reachable it would have paid every selected bill
 * in full, with no partial payment, no discount and no withholding, summing balances across
 * currencies as if they were the same unit. It also summed `bill.balance`, a `decimal` column with
 * no transformer, so `0 + "1500.00" + "200.00"` produced the string `"01500.00200.00"`, which
 * `Number()` turns into `NaN`, which the posting service's `Math.abs(d − c) > 0.01` check then
 * accepted as balanced.
 *
 * ## Tax reached the report but never the ledger
 *
 * `VendorBill` models the DGII 606 breakdown in detail — ITBIS borne, ITBIS withheld, ISR withheld,
 * tax carried to cost, the proportionality rule, excise. The entry produced on approval used none
 * of it: it debited expense or inventory for each line's total and credited payables for the
 * document total. So a bill with tax did not balance and the entry was rejected — silently, because
 * it was posted from an `@OnEvent` handler whose `.catch` only logged, leaving the bill marked open
 * with nothing in the ledger behind it. And the 606 would report withholdings the books never
 * recognised as a liability.
 *
 * Approval now posts synchronously, in the request, with the tax and withholding lines the document
 * describes.
 */
@Injectable()
export class AccountsPayableService {
  private readonly logger = new Logger(AccountsPayableService.name);

  constructor(
    @InjectRepository(VendorBill)
    private readonly vendorBillRepository: Repository<VendorBill>,
    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly workflowsService: WorkflowsService,
    private readonly budgetControlService: BudgetControlService,
    private readonly exchangeRates: ExchangeRateResolver,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Recording
  // ───────────────────────────────────────────────────────────────────────────

  async create(
    dto: CreateVendorBillDto,
    organizationId: string,
  ): Promise<VendorBill> {
    return this.dataSource.transaction(async (manager) => {
      const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
      const baseCurrency = settings?.baseCurrency ?? 'USD';
      const currencyCode = (dto.currencyCode ?? baseCurrency).toUpperCase();

      // Line totals are recomputed, never trusted. The client used to supply `total` per line and
      // for the document, and both were stored verbatim — so the books recorded whatever the
      // caller said the arithmetic was.
      const lines = dto.lines.map((line) => ({
        ...line,
        total: roundAmount(line.quantity * line.unitPrice),
      }));
      const subtotal = sumAmounts(lines.map((line) => line.total));

      const taxAmount = dto.taxAmount ?? 0;
      const exciseAmount = dto.exciseAmount ?? 0;
      const otherTaxes = dto.otherTaxes ?? 0;
      const serviceCharge = dto.serviceCharge ?? 0;
      const expectedTotal = roundAmount(
        subtotal + taxAmount + exciseAmount + otherTaxes + serviceCharge,
      );

      if (dto.total !== undefined && toCents(dto.total) !== toCents(expectedTotal)) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.TOTAL_NO_COINCIDE_CON_LINEAS', {
          expected: expectedTotal,
          received: dto.total,
        });
      }

      // From the document's currency into the books', which is the direction the conversion is
      // actually needed in. The previous code fetched a base→foreign rate and multiplied by it.
      const { amount: totalInBaseCurrency, rate } = await this.exchangeRates.convertAmount(
        expectedTotal,
        currencyCode,
        baseCurrency,
        dto.date,
        manager,
      );

      const bill = manager.create(VendorBill, {
        ...dto,
        organizationId,
        lines,
        total: expectedTotal,
        balance: expectedTotal,
        status: VendorBillStatus.DRAFT,
        currencyCode,
        exchangeRate: rate,
        totalInBaseCurrency,
        goodsAmount: dto.goodsAmount ?? 0,
        servicesAmount: dto.servicesAmount ?? subtotal,
        taxAmount,
        taxWithheld: dto.taxWithheld ?? 0,
        incomeTaxWithheld: dto.incomeTaxWithheld ?? 0,
        taxToCost: dto.taxToCost ?? 0,
        taxProportional: dto.taxProportional ?? 0,
        exciseAmount,
        otherTaxes,
        serviceCharge,
      });

      const saved = await manager.save(bill);
      this.logger.log(`Factura de proveedor ${saved.id} registrada en borrador.`);
      return saved;
    });
  }

  async update(
    id: string,
    dto: UpdateVendorBillDto,
    organizationId: string,
  ): Promise<VendorBill> {
    const bill = await this.findOne(id, organizationId);
    if (bill.status !== VendorBillStatus.DRAFT) {
      throw new ForbiddenError('ACCOUNTS_PAYABLE.SOLO_PUEDEN_EDITAR_FACTURAS_ESTADO_BORRADOR');
    }
    if (dto.lines) {
      throw new BadRequestError(
        'ACCOUNTS_PAYABLE.MODIFICACION_LINEAS_FACTURA_EXISTENTE_DEBE_HACERSE_TRAVES',
      );
    }
    return this.vendorBillRepository.save(this.vendorBillRepository.merge(bill, dto));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Approval and posting
  // ───────────────────────────────────────────────────────────────────────────

  async submitForApproval(
    billId: string,
    organizationId: string,
    actorUserId: string,
  ): Promise<VendorBill> {
    return this.dataSource.transaction(async (manager) => {
      const bill = await manager.findOne(VendorBill, {
        where: { id: billId, organizationId },
        relations: ['lines', 'vendor'],
      });
      if (!bill) {
        throw new NotFoundError('ACCOUNTS_PAYABLE.FACTURA_PROVEEDOR_ID_NO_FUE_ENCONTRADA', {
          id: billId,
        });
      }
      if (bill.status !== VendorBillStatus.DRAFT) {
        throw new BadRequestError(
          'ACCOUNTS_PAYABLE.SOLO_FACTURAS_ESTADO_BORRADOR_PUEDEN_SER_ENVIADAS',
        );
      }

      for (const line of bill.lines) {
        if (!line.expenseAccountId) continue;
        const budgetCheck = await this.budgetControlService.checkBudget(
          organizationId,
          line.expenseAccountId,
          line.total,
          new Date(`${toIsoDate(bill.date)}T00:00:00.000Z`),
        );
        if (budgetCheck.isExceeded) {
          throw new ForbiddenError('ACCOUNTS_PAYABLE.CONTROL_PRESUPUESTARIO_FALLIDO', {
            detail: budgetCheck.messageKey,
            ...(budgetCheck.messageParams ?? {}),
          });
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
        return manager.save(bill);
      }

      // No policy applies, so it is approved on submission — and posted here, in this transaction,
      // rather than announced to an event handler that swallowed its own failures.
      return this.postApprovedBill(manager, bill, organizationId, actorUserId);
    });
  }

  /**
   * Post an approved bill to the ledger.
   *
   * The entry, in full:
   *
   * ```
   *   Dr  expense / inventory        per line, net of tax
   *   Dr  expense                    non-deductible tax carried to cost
   *   Dr  tax receivable             deductible tax borne on the purchase
   *   Dr  expense (other levies)     excise and other taxes
   *       Cr  withholding payable    tax and income tax withheld from the supplier
   *       Cr  service charge payable legally mandated tip, which is never revenue or expense
   *       Cr  accounts payable       what the supplier is actually owed
   * ```
   */
  async postApprovedBill(
    manager: EntityManager,
    bill: VendorBill,
    organizationId: string,
    actorUserId: string | null,
  ): Promise<VendorBill> {
    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    if (!settings?.defaultAccountsPayableId) {
      throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_PAGAR_DEFECTO_NO_ESTA_CONFIGURADA');
    }

    const ledger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
    if (!ledger) {
      throw new BadRequestError(
        'ACCOUNTS_PAYABLE.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION',
      );
    }

    const purchaseJournal = await manager.findOneBy(Journal, {
      organizationId,
      code: 'COMPRAS',
    });
    if (!purchaseJournal) {
      throw new BadRequestError('ACCOUNTS_PAYABLE.DIARIO_COMPRAS_COMPRAS_NO_ENCONTRADO');
    }

    const lines: CreateJournalEntryLineDto[] = [];
    const debit = (accountId: string, amount: number, description: string) => {
      if (toCents(amount) === 0) return;
      lines.push({
        accountId,
        debit: amount,
        credit: 0,
        description,
        valuations: [{ ledgerId: ledger.id, debit: amount, credit: 0 }],
      });
    };
    const credit = (accountId: string, amount: number, description: string) => {
      if (toCents(amount) === 0) return;
      lines.push({
        accountId,
        debit: 0,
        credit: amount,
        description,
        valuations: [{ ledgerId: ledger.id, debit: 0, credit: amount }],
      });
    };

    for (const line of bill.lines) {
      if (line.productId) {
        if (!settings.defaultInventoryId) {
          throw new BadRequestError(
            'ACCOUNTS_PAYABLE.CUENTA_INVENTARIO_DEFECTO_NO_ESTA_CONFIGURADA',
          );
        }
        debit(settings.defaultInventoryId, line.total, `Compra: ${line.product}`);
      } else {
        if (!line.expenseAccountId) {
          throw new BadRequestError(
            'ACCOUNTS_PAYABLE.LINEA_NO_ES_INVENTARIO_REQUIERE_CUENTA_GASTO',
            { product: line.product },
          );
        }
        debit(line.expenseAccountId, line.total, line.product);
      }
    }

    // Deductible tax is an asset — a credit against the tax return. Non-deductible tax and the
    // proportionality remainder are cost, and go wherever the first expense line went, because
    // that is the activity that bore them.
    const costBearingAccountId =
      bill.lines.find((line) => line.expenseAccountId)?.expenseAccountId ??
      settings.defaultInventoryId;
    const deductibleTax = roundAmount(
      bill.taxAmount - bill.taxToCost - bill.taxProportional,
    );

    if (toCents(deductibleTax) !== 0) {
      const taxReceivableId = await this.resolveAccount(
        manager,
        organizationId,
        AccountRole.TAX_RECEIVABLE,
        settings.defaultPurchaseTaxId,
      );
      if (!taxReceivableId) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_IMPUESTO_COMPRAS_NO_CONFIGURADA');
      }
      debit(taxReceivableId, deductibleTax, 'Impuesto sobre compras deducible');
    }

    if (costBearingAccountId) {
      debit(
        costBearingAccountId,
        roundAmount(bill.taxToCost + bill.taxProportional),
        'Impuesto no deducible llevado al costo',
      );
      debit(
        costBearingAccountId,
        roundAmount(bill.exciseAmount + bill.otherTaxes),
        'Impuesto selectivo y otros gravámenes',
      );
    }

    const totalWithheld = roundAmount(bill.taxWithheld + bill.incomeTaxWithheld);
    if (toCents(totalWithheld) !== 0) {
      const withholdingPayableId = await this.resolveAccount(
        manager,
        organizationId,
        AccountRole.WITHHOLDING_PAYABLE,
        settings.defaultTaxWithheldPayableId,
      );
      if (!withholdingPayableId) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_RETENCIONES_NO_CONFIGURADA');
      }
      credit(withholdingPayableId, totalWithheld, 'Retenciones por pagar al fisco');
    }

    if (toCents(bill.serviceCharge) !== 0 && settings.defaultServiceChargePayableId) {
      credit(
        settings.defaultServiceChargePayableId,
        bill.serviceCharge,
        'Propina legal por pagar',
      );
    }

    // What the supplier is actually owed: the document total less anything withheld from them.
    const payable = roundAmount(bill.total - totalWithheld);
    credit(
      settings.defaultAccountsPayableId,
      payable,
      `Factura de proveedor: ${bill.vendor?.name ?? bill.vendorId}`,
    );

    const entry = await this.journalEntriesService.createWithManager(
      manager,
      {
        date: toIsoDate(bill.date),
        description: `Factura de proveedor ${bill.ncf ?? bill.id.slice(0, 8)}`,
        journalId: purchaseJournal.id,
        lines,
        currencyCode: bill.currencyCode,
        exchangeRate: bill.currencyCode === undefined ? undefined : bill.exchangeRate,
      } as CreateJournalEntryDto,
      organizationId,
      { actorUserId, module: ModuleSlug.AP, systemReason: 'vendor-bill-approved' },
    );

    bill.status = VendorBillStatus.OPEN;
    bill.balance = payable;
    const saved = await manager.save(bill);

    this.logger.log(
      `Factura ${bill.id} aprobada y contabilizada en el asiento ${entry.entryNumber}.`,
    );
    this.eventEmitter.emit('vendor.bill.posted', {
      billId: bill.id,
      organizationId,
      journalEntryId: entry.id,
    });
    return saved;
  }

  /**
   * Post a bill whose approval has just been granted.
   *
   * ## Why the failure is now visible
   *
   * The previous handler ran the posting inside `dataSource.transaction(...).catch(err => log)`.
   * A closed period, a missing tax account, or an entry that did not balance therefore left the
   * bill marked OPEN with **nothing in the ledger behind it**, and told nobody. The subledger and
   * the general ledger diverged silently, and there was no report that would show it.
   *
   * A failure now puts the bill in REJECTED with the reason on it and emits an event, so the
   * condition is on the document where an accountant will meet it.
   */
  @OnEvent('approval.request.approved', { async: true })
  async handleBillApproved(payload: {
    documentId: string;
    documentType: string;
    organizationId: string;
    approvedByUserId?: string;
  }): Promise<void> {
    if (payload.documentType !== DocumentTypeForApproval.VENDOR_BILL) return;

    try {
      await this.dataSource.transaction(async (manager) => {
        const bill = await manager.findOne(VendorBill, {
          where: { id: payload.documentId, organizationId: payload.organizationId },
          relations: ['lines', 'vendor'],
        });
        if (!bill || bill.status !== VendorBillStatus.PENDING_APPROVAL) {
          this.logger.warn(
            `Factura ${payload.documentId} no está pendiente de aprobación; se omite.`,
          );
          return;
        }
        await this.postApprovedBill(
          manager,
          bill,
          payload.organizationId,
          payload.approvedByUserId ?? null,
        );
      });
    } catch (error) {
      const reason = (error as Error).message;
      this.logger.error(
        `Factura aprobada ${payload.documentId} no pudo contabilizarse: ${reason}`,
        (error as Error).stack,
      );
      await this.vendorBillRepository.update(
        { id: payload.documentId, organizationId: payload.organizationId },
        { status: VendorBillStatus.REJECTED },
      );
      this.eventEmitter.emit('vendor.bill.posting-failed', {
        billId: payload.documentId,
        organizationId: payload.organizationId,
        reason,
      });
    }
  }

  /** An account by its operational role, falling back to the legacy settings column. */
  private async resolveAccount(
    manager: EntityManager,
    organizationId: string,
    role: AccountRole,
    fallbackId: string | null | undefined,
  ): Promise<string | null> {
    const account = await manager.findOne(Account, {
      where: { organizationId, systemRole: role },
    });
    return account?.id ?? fallbackId ?? null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Payment
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Settle one or more bills from a bank account.
   *
   * Handles what the previous implementation could not: partial settlement, early-payment
   * discounts, withholding at the moment of payment, bills in different currencies in the same run,
   * and the realised exchange difference between the rate a bill was booked at and the rate it is
   * paid at.
   */
  async payBills(
    dto: PayVendorBillsDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<PaymentBatch> {
    return this.dataSource.transaction(async (manager) => {
      const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
      if (!settings?.defaultAccountsPayableId) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_CUENTAS_PAGAR_NO_ESTA_CONFIGURADA');
      }
      const baseCurrency = settings.baseCurrency ?? 'USD';

      const ledger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!ledger) {
        throw new BadRequestError(
          'ACCOUNTS_PAYABLE.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION',
        );
      }

      const paymentJournal = await manager.findOneBy(Journal, {
        organizationId,
        code: 'PAGOS',
      });
      if (!paymentJournal) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.DIARIO_PAGOS_PAGOS_NO_ENCONTRADO');
      }

      // A real bank account, not a chart-of-accounts row: a payment that cannot say which account
      // the funds left cannot be reconciled against the statement that shows them leaving.
      const bankAccount = await manager.findOne(BankAccount, {
        where: { id: dto.bankAccountId, organizationId },
      });
      if (!bankAccount) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_BANCARIA_NO_VALIDA');
      }
      if (!bankAccount.isActive) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_BANCARIA_INACTIVA', {
          name: bankAccount.name,
        });
      }

      const billIds = dto.lines.map((line) => line.vendorBillId);
      const bills = await manager.find(VendorBill, {
        where: { id: In(billIds), organizationId },
      });
      const billsById = new Map(bills.map((bill) => [bill.id, bill]));

      const batch = await manager.save(
        manager.create(PaymentBatch, {
          organizationId,
          paymentDate: toIsoDate(dto.paymentDate) as unknown as Date,
          bankAccountId: dto.bankAccountId,
          reference: dto.reference ?? null,
          status: PaymentBatchStatus.PROCESSING,
          createdByUserId: actorUserId,
        }),
      );

      const entryLines: CreateJournalEntryLineDto[] = [];
      let cashOutBase = 0;
      let payableDebitBase = 0;
      let withheldBase = 0;
      let discountBase = 0;
      let exchangeDifferenceBase = 0;

      for (const line of dto.lines) {
        const bill = billsById.get(line.vendorBillId);
        if (!bill) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.FACTURA_NO_ENCONTRADA_EN_LOTE', {
            id: line.vendorBillId,
          });
        }
        if (
          bill.status !== VendorBillStatus.OPEN &&
          bill.status !== VendorBillStatus.PARTIALLY_PAID
        ) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.FACTURA_NO_ESTA_ABIERTA', {
            id: bill.id,
            status: bill.status,
          });
        }

        const withheld = roundAmount(
          (line.taxWithheld ?? 0) + (line.incomeTaxWithheld ?? 0),
        );
        const discount = roundAmount(line.discount ?? 0);
        const settled = roundAmount(line.amount + withheld + discount);

        if (toCents(settled) > toCents(bill.balance)) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.PAGO_EXCEDE_SALDO', {
            id: bill.id,
            balance: bill.balance,
            settled,
          });
        }

        // Two rates: the one the bill was booked at, and today's. Their difference on the amount
        // settled is a realised gain or loss, and it has to be booked or the payables ledger will
        // not clear.
        const paymentRate = await this.exchangeRates.rateFor(
          bill.currencyCode,
          baseCurrency,
          dto.paymentDate,
          manager,
        );
        const bookedRate = Number(bill.exchangeRate) || 1;

        // The funds leave a real account with a currency of its own. Paying a USD bill out of a
        // EUR account is a conversion at a rate the caller has not stated, and inventing one
        // would misstate cash; paying it out of a base-currency account is measurable at the
        // day's rate, and out of a USD account it is no conversion at all.
        if (
          bankAccount.currencyCode !== bill.currencyCode &&
          bankAccount.currencyCode !== baseCurrency
        ) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.MONEDA_PAGO_NO_COINCIDE_CUENTA_BANCARIA', {
            bill: bill.currencyCode,
            account: bankAccount.currencyCode,
          });
        }

        const cashBase = convert(line.amount, paymentRate);
        const relievedAtBookedRate = convert(settled, bookedRate);
        const withheldAtPaymentRate = convert(withheld, paymentRate);
        const discountAtPaymentRate = convert(discount, paymentRate);
        const difference = roundAmount(
          relievedAtBookedRate -
            (cashBase + withheldAtPaymentRate + discountAtPaymentRate),
        );

        cashOutBase = roundAmount(cashOutBase + cashBase);
        payableDebitBase = roundAmount(payableDebitBase + relievedAtBookedRate);
        withheldBase = roundAmount(withheldBase + withheldAtPaymentRate);
        discountBase = roundAmount(discountBase + discountAtPaymentRate);
        exchangeDifferenceBase = roundAmount(exchangeDifferenceBase + difference);

        bill.balance = roundAmount(bill.balance - settled);
        bill.status =
          toCents(bill.balance) === 0
            ? VendorBillStatus.PAID
            : VendorBillStatus.PARTIALLY_PAID;
        if (bill.status === VendorBillStatus.PAID) {
          bill.paidAt = toIsoDate(dto.paymentDate);
        }
        await manager.save(bill);

        await manager.save(
          manager.create(VendorPayment, {
            paymentBatchId: batch.id,
            vendorBillId: bill.id,
            date: toIsoDate(dto.paymentDate) as unknown as Date,
            amount: settled,
            amountPaid: line.amount,
            taxWithheld: line.taxWithheld ?? 0,
            incomeTaxWithheld: line.incomeTaxWithheld ?? 0,
            discount,
            exchangeDifference: difference,
            exchangeRate: paymentRate,
          }),
        );
      }

      const push = (accountId: string, debitAmount: number, creditAmount: number, description: string) => {
        if (toCents(debitAmount) === 0 && toCents(creditAmount) === 0) return;
        entryLines.push({
          accountId,
          debit: debitAmount,
          credit: creditAmount,
          description,
          valuations: [
            { ledgerId: ledger.id, debit: debitAmount, credit: creditAmount },
          ],
        });
      };

      push(settings.defaultAccountsPayableId, payableDebitBase, 0, 'Cancelación de deuda con proveedores');
      push(bankAccount.glAccountId, 0, cashOutBase, 'Salida de banco por pago a proveedores');

      if (toCents(withheldBase) !== 0) {
        const withholdingPayableId = await this.resolveAccount(
          manager,
          organizationId,
          AccountRole.WITHHOLDING_PAYABLE,
          settings.defaultTaxWithheldPayableId,
        );
        if (!withholdingPayableId) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_RETENCIONES_NO_CONFIGURADA');
        }
        push(withholdingPayableId, 0, withheldBase, 'Retenciones practicadas al proveedor');
      }

      if (toCents(discountBase) !== 0) {
        const discountAccountId = await this.resolveAccount(
          manager,
          organizationId,
          AccountRole.SALES_DISCOUNTS,
          settings.defaultSalesDiscountsId,
        );
        if (!discountAccountId) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_DESCUENTOS_NO_CONFIGURADA');
        }
        push(discountAccountId, 0, discountBase, 'Descuento por pronto pago obtenido');
      }

      if (toCents(exchangeDifferenceBase) !== 0) {
        const forexAccountId = await this.resolveAccount(
          manager,
          organizationId,
          AccountRole.FOREX_GAIN_LOSS,
          settings.defaultForexGainLossAccountId,
        );
        if (!forexAccountId) {
          throw new BadRequestError('ACCOUNTS_PAYABLE.CUENTA_DIFERENCIA_CAMBIARIA_NO_CONFIGURADA');
        }
        push(
          forexAccountId,
          exchangeDifferenceBase < 0 ? Math.abs(exchangeDifferenceBase) : 0,
          exchangeDifferenceBase > 0 ? exchangeDifferenceBase : 0,
          'Diferencia cambiaria realizada en el pago',
        );
      }

      const entry = await this.journalEntriesService.createWithManager(
        manager,
        {
          date: toIsoDate(dto.paymentDate),
          description: `Pago a proveedores — lote ${batch.id.slice(0, 8)}`,
          journalId: paymentJournal.id,
          lines: entryLines,
        } as CreateJournalEntryDto,
        organizationId,
        { actorUserId, module: ModuleSlug.AP, systemReason: 'vendor-payment' },
      );

      batch.status = PaymentBatchStatus.PAID;
      batch.journalEntryId = entry.id;
      const finalBatch = await manager.save(batch);

      this.logger.log(
        `Lote de pago ${finalBatch.id} contabilizado en ${entry.entryNumber}: ${dto.lines.length} facturas.`,
      );
      return finalBatch;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  findAll(organizationId: string): Promise<VendorBill[]> {
    return this.vendorBillRepository.find({
      where: { organizationId },
      order: { date: 'DESC' },
      relations: ['vendor'],
    });
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

  async listPayments(id: string, organizationId: string): Promise<VendorPayment[]> {
    await this.findOne(id, organizationId);
    return this.dataSource.getRepository(VendorPayment).find({
      where: { vendorBillId: id },
      order: { date: 'ASC' },
    });
  }

  /**
   * What is owed, by supplier and by how overdue it is.
   *
   * There was no ageing report of any kind — for payables or receivables — which is the report a
   * treasurer opens to decide what to pay and an auditor asks for to substantiate the balance.
   */
  async aging(organizationId: string, asOf: Date | string = new Date()): Promise<{
    asOfDate: string;
    rows: AgingRow[];
    totals: { current: number; buckets: AgingBucket[]; total: number };
  }> {
    const asOfDate = toIsoDate(asOf);
    const bills = await this.vendorBillRepository.find({
      where: {
        organizationId,
        status: In([VendorBillStatus.OPEN, VendorBillStatus.PARTIALLY_PAID]),
      },
      relations: ['vendor'],
    });

    const cutoff = new Date(`${asOfDate}T00:00:00.000Z`).getTime();
    const byVendor = new Map<string, AgingRow>();

    for (const bill of bills) {
      if (toCents(bill.balance) === 0) continue;
      const due = new Date(`${toIsoDate(bill.dueDate)}T00:00:00.000Z`).getTime();
      const daysOverdue = Math.floor((cutoff - due) / 86_400_000);
      // The books' currency, so a mixed-currency ledger ages into one comparable column.
      const amount = convert(bill.balance, Number(bill.exchangeRate) || 1);

      const row =
        byVendor.get(bill.vendorId) ??
        ({
          partyId: bill.vendorId,
          partyName: bill.vendor?.name ?? bill.vendorId,
          current: 0,
          buckets: AGING_BUCKETS.map((bucket) => ({ ...bucket, amount: 0 })),
          total: 0,
        } satisfies AgingRow);

      if (daysOverdue <= 0) {
        row.current = roundAmount(row.current + amount);
      } else {
        const bucket =
          row.buckets.find(
            (candidate) =>
              daysOverdue >= candidate.from &&
              (candidate.to === null || daysOverdue <= candidate.to),
          ) ?? row.buckets[row.buckets.length - 1];
        bucket.amount = roundAmount(bucket.amount + amount);
      }
      row.total = roundAmount(row.total + amount);
      byVendor.set(bill.vendorId, row);
    }

    const rows = [...byVendor.values()].sort((a, b) => b.total - a.total);
    return {
      asOfDate,
      rows,
      totals: {
        current: sumAmounts(rows.map((row) => row.current)),
        buckets: AGING_BUCKETS.map((bucket, index) => ({
          ...bucket,
          amount: sumAmounts(rows.map((row) => row.buckets[index].amount)),
        })),
        total: sumAmounts(rows.map((row) => row.total)),
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Voiding
  // ───────────────────────────────────────────────────────────────────────────

  async voidBill(
    id: string,
    organizationId: string,
    reason: string,
    actorUserId: string,
  ): Promise<VendorBill> {
    return this.dataSource.transaction(async (manager) => {
      const bill = await manager.findOne(VendorBill, {
        where: { id, organizationId },
        relations: ['lines', 'vendor'],
      });
      if (!bill) {
        throw new NotFoundError('ACCOUNTS_PAYABLE.FACTURA_ANULAR_ID_NO_ENCONTRADA', { id });
      }
      if (bill.status === VendorBillStatus.VOID) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.FACTURA_YA_HA_SIDO_ANULADA');
      }

      // A bill with payments against it cannot be annulled: the payments would be left pointing at
      // a document that no longer owes anything. It used to set `balance = 0` on a partially paid
      // bill and leave the payments orphaned.
      const payments = await manager.count(VendorPayment, { where: { vendorBillId: id } });
      if (payments > 0) {
        throw new BadRequestError('ACCOUNTS_PAYABLE.NO_PUEDE_ANULAR_FACTURA_CON_PAGOS');
      }

      for (const line of bill.lines) {
        if (line.productId) {
          await this.inventoryService.increaseStock(
            line.productId,
            line.quantity,
            manager,
            organizationId,
          );
        }
      }

      bill.status = VendorBillStatus.VOID;
      bill.balance = 0;
      const voided = await manager.save(bill);

      this.eventEmitter.emit('vendor.bill.voided', {
        billId: bill.id,
        organizationId,
        reason,
        actorUserId,
      });
      this.logger.log(`Factura ${id} anulada. Razón: ${reason}`);
      return voided;
    });
  }

  async remove(): Promise<void> {
    throw new ForbiddenError('ACCOUNTS_PAYABLE.ELIMINACION_FACTURAS_NO_ESTA_PERMITIDA_USE_FUNCION');
  }
}
