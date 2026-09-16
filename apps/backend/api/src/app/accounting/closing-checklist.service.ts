import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
import {
  ApprovalRequest,
  ApprovalStatus,
} from '../workflows/entities/approval-request.entity';
import { NotFoundError } from '../i18n/localized.exception';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';
import { JournalQueryService } from '../journal-entries/services/journal-query.service';

// VendorBill and BankTransaction are queried via raw SQL to avoid cross-module entity imports
// that would create cycles: accounting → accounts-payable and accounting → reconciliation.
// The enum values are stable string constants that will not be renamed without a migration.

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

  constructor(
    private readonly dataSource: DataSource,
    private readonly journalQuery: JournalQueryService,
  ) {}

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
      throw new NotFoundError('accounting.accounting_period_period_id_not_found', { periodId });
    }

    const checklist: ChecklistItem[] = [];

    const unpostedEntriesCount = await this.journalQuery.countUnpostedEntriesInPeriod(
      organizationId,
      toIsoDate(period.startDate),
      toIsoDate(period.endDate),
    );
    checklist.push({
      id: 'unposted-journal-entries',
      descriptionKey: 'accounting.checklist.items.unposted_journal_entries',
      params: { count: unpostedEntriesCount },
      isCompleted: unpostedEntriesCount === 0,
      details: { pendingCount: unpostedEntriesCount },
      resolutionLink: `/journal-entries?periodId=${periodId}&status=draft,pending_approval`,
    });

    const [{ count: billCount }] = await this.dataSource.query<[{ count: string }]>(
      // A bill's document date is a calendar date, unlike the journal-entry date above (timestamp).
      `SELECT COUNT(*)::int AS count
         FROM vendor_bills
        WHERE organization_id = $1
          AND status IN ('DRAFT', 'PENDING_APPROVAL')
          AND date BETWEEN $2::date AND $3::date`,
      [organizationId, toIsoDate(period.startDate), toIsoDate(period.endDate)],
    );
    const unapprovedBillsCount = Number(billCount ?? 0);
    checklist.push({
      id: 'unapproved-vendor-bills',
      descriptionKey: 'accounting.checklist.items.unapproved_vendor_bills',
      params: { count: unapprovedBillsCount },
      isCompleted: unapprovedBillsCount === 0,
      details: { pendingCount: unapprovedBillsCount },
      resolutionLink: `/accounts-payable/bills?periodId=${periodId}&status=draft,pending_approval`,
    });

    const [{ count: txCount }] = await this.dataSource.query<[{ count: string }]>(
      `SELECT COUNT(*)::int AS count
         FROM bank_transactions bt
         JOIN bank_statements bs ON bs.id = bt.statement_id
        WHERE bs.organization_id = $1
          AND bt.status = 'UNMATCHED'
          AND bt.date BETWEEN $2::date AND $3::date`,
      [organizationId, toIsoDate(period.startDate), toIsoDate(period.endDate)],
    );
    const unreconciledTxCount = Number(txCount ?? 0);
    checklist.push({
      id: 'unreconciled-bank-transactions',
      descriptionKey: 'accounting.checklist.items.unreconciled_bank_transactions',
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
    const pendingReversals = await this.journalQuery.countPendingAccrualReversals(
      organizationId,
      toIsoDate(period.startDate),
    );
    checklist.push({
      id: 'pending-accrual-reversals',
      descriptionKey: 'accounting.checklist.items.pending_accrual_reversals',
      params: { count: pendingReversals },
      isCompleted: pendingReversals === 0,
      details: { pendingCount: pendingReversals },
      resolutionLink: `/journal-entries?reversesNextPeriod=true&isReversed=false`,
    });

    checklist.push({
      id: 'currency-revaluation',
      descriptionKey: 'accounting.checklist.items.currency_revaluation',
      isCompleted: false,
      noteKey: 'accounting.checklist.manual_step',
      resolutionLink: `/accounting/currency-revaluation`,
    });

    checklist.push({
      id: 'fixed-assets-depreciation',
      descriptionKey: 'accounting.checklist.items.fixed_assets_depreciation',
      isCompleted: false,
      noteKey: 'accounting.checklist.manual_step',
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
      descriptionKey: 'accounting.checklist.items.pending_approvals',
      params: { count: pendingApprovalsCount },
      isCompleted: pendingApprovalsCount === 0,
      details: { pendingCount: pendingApprovalsCount },
      resolutionLink: `/my-work/approvals`,
    });

    return checklist;
  }
}
