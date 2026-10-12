import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { forEachTenant } from '../shared/tenancy/tenant-job';
import { WorkflowEngineService } from './workflow-engine.service';

/**
 * The engine's clock.
 *
 * A TIMER node parks its token with a due time and a task may carry a due date; nothing acts on
 * either by itself. These sweeps do — for each tenant inside its own row-level context (a cron has
 * no request, so `forEachTenant` supplies the tenant the policies key off). One tenant failing never
 * stops the rest, and a sweep that overlaps the previous one (a slow database) is skipped rather
 * than stacked.
 */
@Injectable()
export class WorkflowTimerService {
  private readonly logger = new Logger(WorkflowTimerService.name);
  private sweeping = false;
  private escalating = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly engine: WorkflowEngineService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'workflow-engine-timers' })
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await forEachTenant(this.dataSource, async (organizationId) => {
        const resumed = await this.engine.resumeDueTimers(organizationId);
        if (resumed > 0) {
          this.logger.log(`Reanudadas ${resumed} instancia(s) por temporizador (empresa ${organizationId}).`);
        }
      });
    } finally {
      this.sweeping = false;
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'workflow-engine-escalation' })
  async escalate(): Promise<void> {
    if (this.escalating) return;
    this.escalating = true;
    try {
      await forEachTenant(this.dataSource, async (organizationId) => {
        const escalated = await this.engine.escalateOverdue(organizationId);
        if (escalated > 0) this.logger.log(`${escalated} tarea(s) vencida(s) escalada(s) (empresa ${organizationId}).`);
      });
    } finally {
      this.escalating = false;
    }
  }
}
