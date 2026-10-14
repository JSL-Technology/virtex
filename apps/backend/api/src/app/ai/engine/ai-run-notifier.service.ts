import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { AI_RUN_FINDINGS, AiRunFindingsEvent } from '../../contracts/ai-insights/ai-run-findings.contract';
import { SchedulerLockService } from '../../shared/scheduler/scheduler-lock.service';
import { forEachTenant, runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { currentTenantStore } from '../../shared/tenancy/tenant-context';

/** A run that finished longer ago than this is history, not news: it is closed without a notice. */
const NEWS_FOR_HOURS = 36;

/**
 * Turns what a finished run found into one announcement — the AI telling people, instead of
 * waiting for them to open a screen.
 *
 * Two ways in, one way out:
 *  - the engine completing a job (`AiEngineEventsListener`), which every API replica hears;
 *  - a sweep every three hours, for a run whose completion nobody heard (a deploy, a Redis blip).
 * Both end in `announce`, which claims the run with a conditional UPDATE: of any number of
 * replicas and sweeps, exactly one sees the row come back, and only that one emits.
 */
@Injectable()
export class AiRunNotifierService {
  private readonly logger = new Logger(AiRunNotifierService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    private readonly lock: SchedulerLockService,
  ) {}

  /** Claim a finished run and announce its findings, if it has any worth announcing. */
  async announce(organizationId: string, runId: string): Promise<AiRunFindingsEvent | null> {
    const event = await runAsTenantJob(this.dataSource, organizationId, async () => {
      const manager = currentTenantStore()?.manager ?? this.dataSource.manager;
      const claimed: { id: string; kind: 'FORECAST' | 'ANOMALY'; started_at: Date | null; stale: boolean }[] =
        await manager.query(
          `UPDATE ai_model_runs r
              SET notified_at = now()
            WHERE r.id = $1 AND r.organization_id = $2 AND r.status = 'SUCCEEDED' AND r.notified_at IS NULL
        RETURNING r.id, r.kind, r.started_at,
                  (r.finished_at < now() - make_interval(hours => $3)
                   OR EXISTS (SELECT 1 FROM ai_model_runs n
                               WHERE n.organization_id = r.organization_id AND n.kind = r.kind
                                 AND n.status = 'SUCCEEDED' AND n.finished_at > r.finished_at)) AS stale`,
          [runId, organizationId, NEWS_FOR_HOURS],
        );
      // UPDATE … RETURNING through TypeORM's query() yields [rows, affected] on PostgreSQL.
      const rows = Array.isArray(claimed[0]) ? (claimed[0] as unknown as typeof claimed) : claimed;
      const run = rows[0];
      // Not ours to announce (another replica did, or it is not finished), or superseded/old news.
      if (!run || run.stale) return null;
      return run.kind === 'FORECAST'
        ? this.forecastFindings(manager, organizationId, run.id)
        : this.anomalyFindings(manager, organizationId, run.id, run.started_at);
    });
    if (event) this.events.emit(AI_RUN_FINDINGS, event);
    return event;
  }

  /** The safety net: finished runs nobody announced, across tenants. */
  @Cron('41 */3 * * *')
  async sweep(): Promise<void> {
    const key = new Date().toISOString().slice(0, 13);
    await this.lock.runOnce('ai-run-notices', key, async () => {
      await this.sweepAll();
    });
  }

  async sweepAll(): Promise<number> {
    let announced = 0;
    await forEachTenant(
      this.dataSource,
      async (organizationId) => {
        const manager = currentTenantStore()?.manager ?? this.dataSource.manager;
        const pending: { id: string }[] = await manager.query(
          `SELECT id FROM ai_model_runs
            WHERE organization_id = $1 AND status = 'SUCCEEDED' AND notified_at IS NULL
              AND finished_at > now() - make_interval(hours => $2)
            ORDER BY finished_at`,
          [organizationId, NEWS_FOR_HOURS],
        );
        for (const { id } of pending) {
          if (await this.announce(organizationId, id)) announced++;
        }
      },
      undefined,
      (organizationId, error) =>
        this.logger.warn(`AI run notices could not be swept for ${organizationId}: ${(error as Error)?.message}`),
    );
    return announced;
  }

  private async forecastFindings(manager: EntityManager, organizationId: string, runId: string): Promise<AiRunFindingsEvent | null> {
    const rows: { product_name: string; stockout_date: string | null; total: string }[] = await manager.query(
      `SELECT p.name AS product_name, i.stockout_date::text AS stockout_date, COUNT(*) OVER () AS total
         FROM ai_inventory_insights i JOIN products p ON p.id = i.product_id
        WHERE i.organization_id = $1 AND i.run_id = $2 AND i.status = 'STOCKOUT_RISK'
        ORDER BY i.stockout_date NULLS LAST, i.forecast_30d DESC
        LIMIT 3`,
      [organizationId, runId],
    );
    if (!rows.length) return null;
    return {
      organizationId,
      runId,
      kind: 'FORECAST',
      stockouts: {
        count: Number(rows[0].total),
        earliestDate: rows[0].stockout_date,
        products: [...new Set(rows.map((r) => r.product_name))],
      },
    };
  }

  private async anomalyFindings(
    manager: EntityManager,
    organizationId: string,
    runId: string,
    startedAt: Date | null,
  ): Promise<AiRunFindingsEvent | null> {
    // New in this run: a finding seen before is refreshed by every run, and was announced then.
    const [row]: { count: string; critical: string }[] = await manager.query(
      `SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE severity = 'CRITICAL') AS critical
         FROM ai_anomalies
        WHERE organization_id = $1 AND run_id = $2 AND status = 'OPEN'
          AND severity IN ('HIGH', 'CRITICAL')
          AND ($3::timestamptz IS NULL OR created_at >= $3::timestamptz)`,
      [organizationId, runId, startedAt],
    );
    const count = Number(row?.count ?? 0);
    if (!count) return null;
    return { organizationId, runId, kind: 'ANOMALY', anomalies: { count, critical: Number(row.critical) } };
  }
}
