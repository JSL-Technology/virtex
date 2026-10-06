import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PaymentBatch, PaymentBatchStatus } from './entities/payment-batch.entity';
import { VendorBill, VendorBillStatus } from './entities/vendor-bill.entity';
import { VendorPaymentQueryDto } from './dto/vendor-payment-query.dto';
import { VoidVendorPaymentDto } from './dto/void-vendor-payment.dto';
import { AccountingPostingPort, ModuleSlug } from '../journal-entries/accounting-posting.port';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { applyBranchScope, assertDocumentInScope, loadBranchScope } from '../organizations/contracts/branch.contract';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { roundAmount, toCents } from '../common/money';
import { billPayable } from './vendor-bill-balance';
import type { Paged } from './vendor-debit-notes.service';

/** A payment as the list shows it: what left which account, for how many bills, to whom. */
export interface VendorPaymentRow {
  id: string;
  number: string;
  paymentDate: string;
  status: PaymentBatchStatus;
  reference: string | null;
  branchId: string | null;
  journalEntryId: string | null;
  bankAccountId: string;
  bankAccountName: string;
  currencyCode: string;
  /** What left the bank, in the bank account's currency. */
  totalPaid: number;
  billCount: number;
  suppliers: string | null;
}

/**
 * Payments to suppliers, as documents (audit H-14).
 *
 * Paying is `AccountsPayableService.payBills`; this is everything after: the list Odoo calls
 * *Payments*, NetSuite *Bill Payments* and SAP *Manage Outgoing Payments*, one payment opened by
 * itself, and voiding one — a cheque returned, a transfer rejected, a payment keyed against the
 * wrong bill. Until now a payment, once made, could be neither found nor undone.
 */
@Injectable()
export class VendorPaymentsService {
  private readonly logger = new Logger(VendorPaymentsService.name);

  constructor(
    @InjectRepository(PaymentBatch)
    private readonly batches: Repository<PaymentBatch>,
    private readonly dataSource: DataSource,
    private readonly posting: AccountingPostingPort,
  ) {}

  async findAll(
    organizationId: string,
    query: VendorPaymentQueryDto = {},
    actorUserId?: string,
  ): Promise<Paged<VendorPaymentRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const qb = this.batches
      .createQueryBuilder('batch')
      .innerJoin('batch.bankAccount', 'bank')
      .leftJoin('batch.payments', 'payment')
      .leftJoin('payment.vendorBill', 'bill')
      .leftJoin('bill.vendor', 'vendor')
      .where('batch.organizationId = :organizationId', { organizationId });
    if (query.status) qb.andWhere('batch.status = :status', { status: query.status });
    if (query.bankAccountId) qb.andWhere('batch.bankAccountId = :bankAccountId', { bankAccountId: query.bankAccountId });
    if (query.from) qb.andWhere('batch.paymentDate >= :from', { from: query.from.slice(0, 10) });
    if (query.to) qb.andWhere('batch.paymentDate <= :to', { to: query.to.slice(0, 10) });
    if (query.supplierId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM "vendor_payment" vp JOIN "vendor_bills" vb ON vb."id" = vp."vendor_bill_id"
                  WHERE vp."payment_batch_id" = batch.id AND vb."vendor_id" = :supplierId)`,
        { supplierId: query.supplierId },
      );
    }
    if (actorUserId || query.branchId) {
      const scope = await loadBranchScope(this.dataSource.manager, organizationId, actorUserId ?? null);
      applyBranchScope(qb, 'batch', scope, query.branchId);
    }

    const total = await qb.clone().select('batch.id').distinct(true).getCount();
    const rows = await qb
      .select([
        'batch.id AS "id"',
        'batch.number AS "number"',
        'batch.status AS "status"',
        'batch.reference AS "reference"',
        'batch.branchId AS "branchId"',
        'batch.journalEntryId AS "journalEntryId"',
        'bank.id AS "bankAccountId"',
        'bank.name AS "bankAccountName"',
        'bank.currencyCode AS "currencyCode"',
      ])
      // As text: a raw `date` comes back from the driver as a local-time Date, which moves a day
      // for any server east or west of Greenwich.
      .addSelect(`TO_CHAR(batch.paymentDate, 'YYYY-MM-DD')`, 'paymentDate')
      .addSelect('COALESCE(SUM(payment.amountPaid), 0)', 'totalPaid')
      .addSelect('COUNT(payment.id)', 'billCount')
      .addSelect(`STRING_AGG(DISTINCT vendor.name, ', ')`, 'suppliers')
      .groupBy('batch.id')
      .addGroupBy('bank.id')
      .orderBy('batch.paymentDate', 'DESC')
      .addOrderBy('batch.number', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<VendorPaymentRow>();

    const items = rows.map((row) => ({
      ...row,
      totalPaid: Number(row.totalPaid),
      billCount: Number(row.billCount),
    }));
    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  async findOne(id: string, organizationId: string, actorUserId?: string): Promise<PaymentBatch> {
    const batch = await this.batches.findOne({
      where: { id, organizationId },
      relations: ['bankAccount', 'payments', 'payments.vendorBill', 'payments.vendorBill.vendor'],
    });
    if (!batch) throw new NotFoundError('accounts_payable.payment_not_found');
    if (actorUserId) {
      assertDocumentInScope(await loadBranchScope(this.dataSource.manager, organizationId, actorUserId), batch.branchId);
    }
    return batch;
  }

  /**
   * Undo a payment: every bill it settled owes again what it settled, and its entry is reversed —
   * not deleted — so the correction reads in the book on the day it was made.
   *
   * A payment whose bank line was already matched to a statement cannot be reversed until it is
   * unmatched: the ledger refuses to reverse reconciled lines, and that refusal is the right answer
   * — the bank says the money left.
   */
  async voidPayment(
    id: string,
    dto: VoidVendorPaymentDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<PaymentBatch> {
    const reason = dto.reason.trim();
    return this.dataSource.transaction(async (manager) => {
      // The batch row first, by id: a second void, or a void racing nothing else, waits here.
      await manager.query(`SELECT "id" FROM "payment_batches" WHERE "id" = $1 AND "organization_id" = $2 FOR UPDATE`, [
        id,
        organizationId,
      ]);
      const batch = await manager.findOne(PaymentBatch, { where: { id, organizationId }, relations: ['payments'] });
      if (!batch) throw new NotFoundError('accounts_payable.payment_not_found');
      if (batch.status === PaymentBatchStatus.VOID) {
        throw new ConflictError('accounts_payable.payment_already_voided', { number: batch.number });
      }
      if (batch.status !== PaymentBatchStatus.PAID) {
        throw new BadRequestError('accounts_payable.payment_not_voidable', { status: batch.status });
      }

      for (const payment of batch.payments) {
        await manager.query(`SELECT "id" FROM "vendor_bills" WHERE "id" = $1 AND "organization_id" = $2 FOR UPDATE`, [
          payment.vendorBillId,
          organizationId,
        ]);
        const bill = await manager.findOne(VendorBill, { where: { id: payment.vendorBillId, organizationId } });
        if (!bill) continue;
        bill.balance = roundAmount(Number(bill.balance) + Number(payment.amount));
        bill.status =
          toCents(bill.balance) >= toCents(billPayable(bill)) ? VendorBillStatus.OPEN : VendorBillStatus.PARTIALLY_PAID;
        bill.paidAt = null;
        await manager.save(bill);
      }

      if (batch.journalEntryId) {
        const reversal = await this.posting.createSystemReversal(
          batch.journalEntryId,
          organizationId,
          {
            reversalDate: (dto.reversalDate ?? (await organizationToday(manager, organizationId))).slice(0, 10),
            reason: `Anulación de pago ${batch.number}: ${reason}`,
          },
          manager,
          { actorUserId, module: ModuleSlug.AP, systemReason: 'vendor-payment-void' },
        );
        batch.reversalJournalEntryId = reversal.id;
      }

      batch.status = PaymentBatchStatus.VOID;
      batch.voidReason = reason;
      batch.voidedAt = new Date();
      batch.voidedByUserId = actorUserId;
      const saved = await manager.save(PaymentBatch, batch);
      this.logger.log(`Pago ${batch.number} anulado: ${reason}.`);
      return saved;
    });
  }
}
