import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ExclusiveJob } from '../../shared/scheduling/exclusive-job';
import { forEachTenant } from '../../shared/tenancy/tenant-job';
import { SchedulerLockService } from '../../shared/scheduler/scheduler-lock.service';
import { externalEffectAllowed, ExternalEffect } from '../../config/external-effects';
import { FiscalSubmissionService } from './fiscal-submission.service';
import { FiscalSubmissionStatus } from '../entities/fiscal-submission.entity';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Transmits what the after-commit attempt did not, and asks for the verdicts still outstanding
 * (FAC-EINV-01). Each firing is claimed through `SchedulerLockService` for its five-minute slot,
 * and each submission through `FiscalSubmissionService.claim`, so neither several replicas nor an
 * overlapping manual retry can send a document twice.
 */
@Injectable()
export class FiscalSubmissionReconciler {
  private readonly logger = new Logger(FiscalSubmissionReconciler.name);

  constructor(
    private readonly submissions: FiscalSubmissionService,
    private readonly dataSource: DataSource,
    private readonly schedulerLock: SchedulerLockService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  @ExclusiveJob()
  async reconcile(): Promise<void> {
    // With fiscal-authority calls disabled every attempt would end NOT_CONFIGURED: do not start.
    if (!externalEffectAllowed(ExternalEffect.FiscalAuthority)) return;
    await this.schedulerLock.pruneFinished('fiscal-submissions', ONE_DAY_MS);
    await this.schedulerLock.runOnce('fiscal-submissions', slot(5), () =>
      forEachTenant(
        this.dataSource,
        async (organizationId) => {
          for (const due of await this.submissions.findDue(organizationId, 50)) {
            try {
              if (due.status === FiscalSubmissionStatus.SENT) await this.submissions.poll(due.id, organizationId);
              else await this.submissions.process(due.invoiceId, organizationId);
            } catch (error) {
              this.logger.warn(`Fiscal submission ${due.id} could not be reconciled: ${(error as Error).message}`);
            }
          }
        },
        undefined,
        (id, error) => this.logger.error(`Fiscal reconciliation failed for organization ${id}: ${(error as Error).message}`),
      ),
    );
  }
}

function slot(minutes: number): string {
  const size = minutes * 60 * 1000;
  return new Date(Math.floor(Date.now() / size) * size).toISOString();
}
