import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { EcfSubmissionService } from './ecf-submission.service';
import { allOrganizationIds } from '../../organizations/contracts/tenant-directory.contract';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { SchedulerLockService } from '../../shared/scheduler/scheduler-lock.service';

/**
 * Background reconciliation for e-CF:
 *   - polls the DGII for the verdict of documents still "En Proceso";
 *   - re-attempts documents left pending, in contingency or in error after a DGII outage.
 *
 * Each tenant is processed inside its own tenant context. The loops used to query
 * `ecf_submissions` with no context at all, which under the row-level policies — with the
 * application connected as the unprivileged role, as in production — returns no rows: the
 * reconciler ran every few minutes and never found anything to do.
 *
 * Every firing is claimed through `SchedulerLockService`, keyed by its time slot, so several API
 * instances never transmit the same document twice. Both loops are best-effort and defensive: one
 * failing document or tenant never aborts the batch.
 */
@Injectable()
export class EcfReconcilerService {
  private readonly logger = new Logger(EcfReconcilerService.name);

  constructor(
    private readonly submissions: EcfSubmissionService,
    private readonly dataSource: DataSource,
    private readonly schedulerLock: SchedulerLockService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async pollPendingVerdicts(): Promise<void> {
    await this.schedulerLock.pruneFinished('ecf-poll-verdicts', ONE_DAY_MS);
    await this.schedulerLock.runOnce('ecf-poll-verdicts', slot(5), () =>
      this.forEachTenant(async (organizationId) => {
        const pending = await this.submissions.findPollable(organizationId, 100);
        for (const submission of pending) {
          try {
            await this.submissions.pollStatus(submission);
          } catch (err) {
            this.logger.warn(`Could not poll e-CF ${submission.ncf}: ${(err as Error).message}`);
          }
        }
      }),
    );
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async retryContingency(): Promise<void> {
    await this.schedulerLock.pruneFinished('ecf-retry-contingency', ONE_DAY_MS);
    await this.schedulerLock.runOnce('ecf-retry-contingency', slot(10), () =>
      this.forEachTenant(async (organizationId) => {
        const retriable = await this.submissions.findRetriable(organizationId, 50);
        for (const submission of retriable) {
          try {
            await this.submissions.submitInvoice(submission.invoiceId, submission.organizationId);
          } catch (err) {
            this.logger.warn(`Retry failed for e-CF ${submission.ncf}: ${(err as Error).message}`);
          }
        }
      }),
    );
  }

  /** Runs `work` once per tenant, each inside that tenant's own context. */
  private async forEachTenant(work: (organizationId: string) => Promise<void>): Promise<void> {
    for (const id of await allOrganizationIds(this.dataSource.manager)) {
      await runAsTenantJob(this.dataSource, id, () => work(id)).catch((error) =>
        this.logger.error(`e-CF reconciliation failed for organization ${id}: ${(error as Error).message}`),
      );
    }
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** The current time slot of `minutes` length, as a stable key for the scheduler lock. */
function slot(minutes: number): string {
  const size = minutes * 60 * 1000;
  return new Date(Math.floor(Date.now() / size) * size).toISOString();
}
