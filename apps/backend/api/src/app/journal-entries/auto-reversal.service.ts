import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, LessThan } from 'typeorm';
import { JournalEntry, JournalEntryStatus } from './entities/journal-entry.entity';
import { JournalEntriesService } from './journal-entries.service';
import {
  AccountingPeriod,
  PeriodStatus,
} from '../accounting/entities/accounting-period.entity';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';

/**
 * Reverses accruals flagged `reversesNextPeriod` on the first of the following month.
 *
 * ## Why the in-process flag is gone
 *
 * It was `private isJobRunning = false`. That is correct for exactly one process and silently wrong
 * for two: with a second replica, every accrual was reversed twice, and the duplicate looks like an
 * ordinary posting. The claim now lives in the database, keyed by tenant and period, so it holds
 * across replicas and across restarts.
 */
@Injectable()
export class AutoReversalService {
  private readonly logger = new Logger(AutoReversalService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly schedulerLock: SchedulerLockService,
    /** Where a failed reversal is recorded, so it is queryable rather than only logged. */
    private readonly auditTrail: AuditTrailService,
  ) {}

  @Cron('0 4 1 * *', { name: 'auto-reversals' })
  async handleCron(): Promise<void> {
    const today = new Date();
    const firstOfThisMonth = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    const lastOfPreviousMonth = new Date(firstOfThisMonth);
    lastOfPreviousMonth.setUTCDate(0);
    const periodLabel = `${lastOfPreviousMonth.getUTCFullYear()}-${String(
      lastOfPreviousMonth.getUTCMonth() + 1,
    ).padStart(2, '0')}`;

    const periods = await this.dataSource.getRepository(AccountingPeriod).find({
      where: {
        endDate: toIsoDate(lastOfPreviousMonth) as unknown as Date,
        status: PeriodStatus.OPEN,
      },
    });

    for (const period of periods) {
      await this.schedulerLock
        .runOnce('auto-reversals', `${period.organizationId}:${periodLabel}`, () =>
          this.reverseAccrualsFor(period.organizationId, firstOfThisMonth),
        )
        .catch((error) => {
          this.logger.error(
            `Reversiones automáticas fallidas para ${period.organizationId}: ${(error as Error).message}`,
          );
        });
    }
  }

  private async reverseAccrualsFor(
    organizationId: string,
    firstOfThisMonth: Date,
  ): Promise<void> {
    const entriesToReverse = await this.dataSource.getRepository(JournalEntry).find({
      where: {
        organizationId,
        reversesNextPeriod: true,
        isReversed: false,
        status: JournalEntryStatus.POSTED,
        date: LessThan(toIsoDate(firstOfThisMonth) as unknown as Date),
      },
    });

    if (entriesToReverse.length === 0) return;

    for (const entry of entriesToReverse) {
      try {
        await this.journalEntriesService.createReversalEntry(entry.id, organizationId, {
          actorUserId: null,
          systemReason: 'scheduled-accrual-reversal',
        });
        this.logger.log(`Asiento ${entry.entryNumber} revertido automáticamente.`);
      } catch (error) {
        // One accrual that cannot be reversed — a closed period, a reconciled line — must not stop
        // the rest. It is recorded per entry and the claim still completes, because retrying the
        // whole month would re-reverse the ones that succeeded.
        //
        // Recorded, not merely logged. An accrual left standing overstates the next period's
        // result by its own amount, and the log is read by nobody: the failure goes to the audit
        // trail, where it is queryable, and the entry keeps `reversesNextPeriod` set, which is
        // what puts it on the closing checklist of the period it is distorting.
        this.logger.error(
          `No se pudo revertir ${entry.entryNumber ?? entry.id}: ${(error as Error).message}`,
        );
        await this.auditTrail
          .record(
            // No user: the scheduler acted. `system_reason` on the payload says which process.
            null as unknown as string,
            'journal_entries',
            entry.id,
            ActionType.UPDATE,
            {
              event: 'accrual-reversal-failed',
              systemReason: 'scheduled-accrual-reversal',
              entryNumber: entry.entryNumber,
              date: toIsoDate(entry.date),
              reason: (error as Error).message,
            },
            undefined,
            undefined,
            organizationId,
          )
          .catch(() => undefined);
      }
    }
  }
}
