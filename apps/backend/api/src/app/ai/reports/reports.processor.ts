import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { AI_REPORTS_QUEUE, ReportsService } from './reports.service';

/** Writes queued reports, each inside its own tenant's context (row-level security applies). */
@Processor(AI_REPORTS_QUEUE)
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(
    private readonly reports: ReportsService,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async process(job: Job<{ organizationId: string; reportId: string }>): Promise<void> {
    const attempts = Number(job.opts?.attempts ?? 1);
    const finalAttempt = job.attemptsMade + 1 >= attempts;
    try {
      await runAsTenantJob(this.dataSource, job.data.organizationId, () =>
        this.reports.generate(job.data.organizationId, job.data.reportId, finalAttempt),
      );
    } catch (error) {
      this.logger.warn(`Report ${job.data.reportId} failed (attempt ${job.attemptsMade + 1}/${attempts}): ${(error as Error).message}`);
      throw error;
    }
  }
}
