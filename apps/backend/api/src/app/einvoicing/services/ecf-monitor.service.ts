import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { Gauge, register } from 'prom-client';
import { forEachTenant } from '../../shared/tenancy/tenant-job';
import { SchedulerLockService } from '../../shared/scheduler/scheduler-lock.service';

/** A document unresolved this long is a problem somebody must look at. */
const STUCK_AFTER_MINUTES = 60;

/** The states that mean «the DGII does not have this document, or refused it». */
const PROBLEM_STATES = ['PENDING', 'SIGNED', 'CONTINGENCY', 'ERROR', 'REJECTED'] as const;

export interface EcfProblemSummary {
  organizationId: string;
  counts: Record<string, number>;
  oldest: string | null;
}

/**
 * The failure that costs the most in this product is quiet: an e-CF issued, numbered and handed to
 * the customer that never reached the DGII, or that the DGII rejected. The reconciler retries what
 * can be retried; this watches what it could not fix.
 *
 * Every 15 minutes it counts, per tenant, documents stuck for over an hour in a problem state, and
 *  - publishes them as `virteex_ecf_unresolved{status}` for Prometheus to alert on;
 *  - logs one structured `ecf_unresolved` warning per affected tenant;
 *  - posts a summary to `ALERT_WEBHOOK_URL` (Slack/Teams/Google Chat-compatible JSON `{text}`)
 *    when one is configured.
 */
@Injectable()
export class EcfMonitorService {
  private readonly logger = new Logger(EcfMonitorService.name);
  private readonly gauge: Gauge<string>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly schedulerLock: SchedulerLockService,
    private readonly config: ConfigService,
  ) {
    const existing = register.getSingleMetric('virteex_ecf_unresolved') as Gauge<string> | undefined;
    this.gauge =
      existing ??
      new Gauge({
        name: 'virteex_ecf_unresolved',
        help: `e-CF unresolved for over ${STUCK_AFTER_MINUTES} minutes, by status`,
        labelNames: ['status'],
      });
  }

  @Cron('*/15 * * * *', { name: 'ecf-monitor' })
  async watch(): Promise<void> {
    const now = new Date();
    const slot = `${now.toISOString().slice(0, 13)}:${Math.floor(now.getUTCMinutes() / 15)}`;
    await this.schedulerLock.runOnce('ecf-monitor', slot, async () => {
      await this.scan();
    });
  }

  async scan(): Promise<EcfProblemSummary[]> {
    const problems: EcfProblemSummary[] = [];
    await forEachTenant(this.dataSource, async (organizationId) => {
      const rows: Array<{ status: string; n: number; oldest: Date }> = await this.dataSource.query(
        `SELECT "status", count(*)::int AS n, min("created_at") AS oldest
           FROM "ecf_submissions"
          WHERE "organization_id" = $1 AND "status" = ANY($2)
            AND "updated_at" < now() - ($3 || ' minutes')::interval
          GROUP BY "status"`,
        [organizationId, PROBLEM_STATES, String(STUCK_AFTER_MINUTES)],
      );
      if (!rows.length) return;
      problems.push({
        organizationId,
        counts: Object.fromEntries(rows.map((r) => [r.status, r.n])),
        oldest: rows.map((r) => new Date(r.oldest).toISOString()).sort()[0] ?? null,
      });
    });

    const totals: Record<string, number> = Object.fromEntries(PROBLEM_STATES.map((s) => [s, 0]));
    for (const p of problems) for (const [s, n] of Object.entries(p.counts)) totals[s] += n;
    for (const [status, n] of Object.entries(totals)) this.gauge.set({ status }, n);

    for (const p of problems) {
      this.logger.warn({ event: 'ecf_unresolved', ...p }, 'e-CF unresolved for over an hour');
    }
    if (problems.length) await this.alert(problems, totals);
    return problems;
  }

  private async alert(problems: EcfProblemSummary[], totals: Record<string, number>): Promise<void> {
    const url = this.config.get<string>('ALERT_WEBHOOK_URL');
    if (!url) return;
    const summary = Object.entries(totals)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${s}: ${n}`)
      .join(', ');
    const text = `⚠️ e-CF sin resolver hace más de ${STUCK_AFTER_MINUTES} min en ${problems.length} empresa(s) — ${summary}`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.error(`Alert webhook failed: ${(error as Error).message}`);
    }
  }
}
