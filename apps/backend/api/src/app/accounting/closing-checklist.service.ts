import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In, Between, LessThan } from 'typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
import {
  JournalEntry,
  JournalEntryStatus,
} from '../journal-entries/entities/journal-entry.entity';
import {
  BankTransaction,
  TransactionStatus,
} from '../reconciliation/entities/bank-transaction.entity';
import {
  VendorBill,
  VendorBillStatus,
} from '../accounts-payable/entities/vendor-bill.entity';
import {
  ApprovalRequest,
  ApprovalStatus,
} from '../workflows/entities/approval-request.entity';
import { NotFoundError } from '../i18n/localized.exception';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';

export interface ChecklistItem {
  /** Stable identifier for the check. Never rendered. */
  id: string;
  /**
   * A catalogue key, not a sentence.
   *
   * The closing checklist is read by whoever is closing the month, and in a group with
   * subsidiaries that is rarely the same person twice. The descriptions were Spanish literals
   * composed in the service.
   */
  descriptionKey: string;
  /** Interpolation values for `descriptionKey` — counts, never prose. */
  params?: Record<string, unknown>;
  isCompleted: boolean;
  /**
   * Why the item cannot be decided automatically, where that is the case. A key, like everything
   * else the reader sees.
   */
  noteKey?: string;
  /** Counts backing the check, for the client to render alongside the description. */
  details?: Record<string, number>;
  resolutionLink?: string;
}

@Injectable()
export class ClosingChecklistService {
  private readonly logger = new Logger(ClosingChecklistService.name);

  constructor(private readonly dataSource: DataSource) {}

  async getChecklist(
    periodId: string,
    organizationId: string,
  ): Promise<ChecklistItem[]> {
    this.logger.log(
      `Generando checklist de cierre para el período ${periodId} en la organización ${organizationId}`,
    );

    const period = await this.dataSource
      .getRepository(AccountingPeriod)
      .findOneBy({ id: periodId, organizationId });
    if (!period) {
      throw new NotFoundError('ACCOUNTING.PERIODO_CONTABLE_ID_NO_ENCONTRADO', { periodId });
    }

    const checklist: ChecklistItem[] = [];

    const unpostedEntriesCount = await this.dataSource
      .getRepository(JournalEntry)
      .count({
        where: {
          organizationId,
          status: In([
            JournalEntryStatus.DRAFT,
            JournalEntryStatus.PENDING_APPROVAL,
          ]),
          date: Between(period.startDate, period.endDate),
        },
      });
    checklist.push({
      id: 'unposted-journal-entries',
      descriptionKey: 'ACCOUNTING.CHECKLIST.ITEMS.UNPOSTED_JOURNAL_ENTRIES',
      params: { count: unpostedEntriesCount },
      isCompleted: unpostedEntriesCount === 0,
      details: { pendingCount: unpostedEntriesCount },
      resolutionLink: `/journal-entries?periodId=${periodId}&status=draft,pending_approval`,
    });

    const unapprovedBillsCount = await this.dataSource
      .getRepository(VendorBill)
      .count({
        where: {
          organizationId,
          status: In([
            VendorBillStatus.DRAFT,
            VendorBillStatus.PENDING_APPROVAL,
          ]),
          date: Between(period.startDate, period.endDate),
        },
      });
    checklist.push({
      id: 'unapproved-vendor-bills',
      descriptionKey: 'ACCOUNTING.CHECKLIST.ITEMS.UNAPPROVED_VENDOR_BILLS',
      params: { count: unapprovedBillsCount },
      isCompleted: unapprovedBillsCount === 0,
      details: { pendingCount: unapprovedBillsCount },
      resolutionLink: `/accounts-payable/bills?periodId=${periodId}&status=draft,pending_approval`,
    });

    const unreconciledTxCount = await this.dataSource
      .getRepository(BankTransaction)
      .count({
        where: {
          statement: { organizationId },
          status: TransactionStatus.UNMATCHED,
          date: Between(toIsoDate(period.startDate), toIsoDate(period.endDate)),
        },
      });
    checklist.push({
      id: 'unreconciled-bank-transactions',
      descriptionKey: 'ACCOUNTING.CHECKLIST.ITEMS.UNRECONCILED_BANK_TRANSACTIONS',
      params: { count: unreconciledTxCount },
      isCompleted: unreconciledTxCount === 0,
      details: { unreconciledCount: unreconciledTxCount },
      resolutionLink: `/reconciliation?periodId=${periodId}`,
    });

    // Accruals that should have reversed into this period and did not.
    //
    // `AutoReversalService` reverses each flagged accrual on the first of the following month and
    // logs the ones it cannot — a closed period, a reconciled line. That log is read by nobody: an
    // accrual left standing overstates the next period's result by its own amount, and the person
    // closing that period is exactly who needs to know. Here it is a line of the checklist, with
    // the entries named.
    const pendingReversals = await this.dataSource.getRepository(JournalEntry).count({
      where: {
        organizationId,
        reversesNextPeriod: true,
        isReversed: false,
        status: JournalEntryStatus.POSTED,
        date: LessThan(toIsoDate(period.startDate) as unknown as Date),
      },
    });
    checklist.push({
      id: 'pending-accrual-reversals',
      descriptionKey: 'ACCOUNTING.CHECKLIST.ITEMS.PENDING_ACCRUAL_REVERSALS',
      params: { count: pendingReversals },
      isCompleted: pendingReversals === 0,
      details: { pendingCount: pendingReversals },
      resolutionLink: `/journal-entries?reversesNextPeriod=true&isReversed=false`,
    });

    checklist.push({
      id: 'currency-revaluation',
      descriptionKey: 'ACCOUNTING.CHECKLIST.ITEMS.CURRENCY_REVALUATION',
      isCompleted: false,
      noteKey: 'ACCOUNTING.CHECKLIST.MANUAL_STEP',
      resolutionLink: `/accounting/currency-revaluation`,
    });

    checklist.push({
      id: 'fixed-assets-depreciation',
      descriptionKey: 'ACCOUNTING.CHECKLIST.ITEMS.FIXED_ASSETS_DEPRECIATION',
      isCompleted: false,
      noteKey: 'ACCOUNTING.CHECKLIST.MANUAL_STEP',
      resolutionLink: `/fixed-assets/depreciation`,
    });

    const pendingApprovalsCount = await this.dataSource
      .getRepository(ApprovalRequest)
      .count({
        where: {
          organizationId,
          status: ApprovalStatus.PENDING,
        },
      });
    checklist.push({
      id: 'pending-general-approvals',
      descriptionKey: 'ACCOUNTING.CHECKLIST.ITEMS.PENDING_APPROVALS',
      params: { count: pendingApprovalsCount },
      isCompleted: pendingApprovalsCount === 0,
      details: { pendingCount: pendingApprovalsCount },
      resolutionLink: `/my-work/approvals`,
    });

    return checklist;
  }
}
