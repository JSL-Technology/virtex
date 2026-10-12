import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { forEachTenant } from '../shared/tenancy/tenant-job';
import { WorkflowEngineService } from './workflow-engine.service';

/**
 * Wakes parked timer tokens.
 *
 * A TIMER node parks its token with a due time; nothing resumes it on its own. This sweep is what
 * does — once a minute, for each tenant inside its own row-level context (a cron has no request, so
 * `forEachTenant` supplies the tenant the policies key off), it resumes the instances whose earliest
 * timer has come due. One tenant failing never stops the rest.
 */
@Injectable()
export class WorkflowTimerService {
  private readonly logger = new Logger(WorkflowTimerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly engine: WorkflowEngineService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'workflow-engine-timers' })
  async sweep(): Promise<void> {
    await forEachTenant(this.dataSource, async (organizationId) => {
      const resumed = await this.engine.resumeDueTimers(organizationId);
      if (resumed > 0) {
        this.logger.log(`Reanudadas ${resumed} instancia(s) por temporizador (empresa ${organizationId}).`);
      }
    });
  }
}
