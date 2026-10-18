import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { EngineRunsService } from './engine-runs.service';
import { EntitlementsPort } from '../../saas/contracts/entitlements.contract';
import { SchedulerLockService } from '../../shared/scheduler/scheduler-lock.service';
import { forEachTenant } from '../../shared/tenancy/tenant-job';
import { CashflowService } from '../cashflow/cashflow.service';
import { ReportsService } from '../reports/reports.service';
import { DataQualityService } from '../data-quality/data-quality.service';
import { previousMonth } from '../reports/manager-report.builder';
import { currentTenantStore } from '../../shared/tenancy/tenant-context';

/** A tenant that ran this kind in the last 20 hours is fresh enough to skip tonight. */
const FRESH_FOR_MS = 20 * 60 * 60 * 1000;

/**
 * The nightly forecasting and anomaly runs.
 *
 * Fired once per night across all replicas (the scheduler lock claims the date), and only for
 * tenants whose plan includes the feature — a run the plan does not pay for is compute nobody
 * asked for. The work itself is queued, so this finishes in seconds whatever the number of tenants;
 * the engine works through the queue at the pace its workers allow.
 */
@Injectable()
export class AiSchedulerService {
  private readonly logger = new Logger(AiSchedulerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly runs: EngineRunsService,
    private readonly entitlements: EntitlementsPort,
    private readonly lock: SchedulerLockService,
    private readonly cashflow: CashflowService,
    private readonly reports: ReportsService,
    private readonly quality: DataQualityService,
  ) {}

  // Sundays at 03:23: duplicates are looked for weekly; no model is called, so every plan has it.
  @Cron('23 3 * * 0')
  async weekly(): Promise<void> {
    const runKey = new Date().toISOString().slice(0, 10);
    await this.lock.runOnce('ai-weekly-data-quality', runKey, async () => {
      await forEachTenant(
        this.dataSource,
        async (organizationId) => {
          await this.quality.scan(organizationId);
        },
        undefined,
        (organizationId, error) =>
          this.logger.error(`Duplicate scan failed for ${organizationId}: ${(error as Error)?.message}`),
      );
    });
  }

  // 06:41 on the 1st: after the night's runs, so the report reads a projection made that morning.
  @Cron('41 6 1 * *')
  async monthly(): Promise<void> {
    const period = previousMonth();
    await this.lock.runOnce('ai-monthly-reports', period, async () => {
      await this.queueMonthlyReports(period);
    });
  }

  /** The manager's report for `period`, for every tenant whose plan includes it and lacks one. */
  async queueMonthlyReports(period: string): Promise<number> {
    let queued = 0;
    await forEachTenant(
      this.dataSource,
      async (organizationId) => {
        if (!(await this.entitlements.checkFeature(organizationId, 'ai_manager_reports'))) return;
        if (await this.reports.exists(organizationId, 'MANAGER_MONTHLY', period)) return;
        const manager = currentTenantStore()?.manager ?? this.dataSource.manager;
        const [org]: Array<{ language: string | null }> = await manager.query(
          `SELECT "books_language" AS language FROM "organizations" WHERE "id" = $1`,
          [organizationId],
        );
        await this.reports.request(organizationId, null, 'MANAGER_MONTHLY', { period, language: org?.language ?? 'es' });
        queued++;
      },
      undefined,
      (organizationId, error) =>
        this.logger.error(`Monthly report could not be queued for ${organizationId}: ${(error as Error)?.message}`),
    );
    this.logger.log(`Monthly manager reports queued for ${period}: ${queued}.`);
    return queued;
  }

  // 02:17 server time: after midnight closes the day's sales, away from the round hours other
  // jobs cluster on.
  @Cron('17 2 * * *')
  async nightly(): Promise<void> {
    const runKey = new Date().toISOString().slice(0, 10);
    await this.lock.runOnce('ai-nightly-runs', runKey, async () => {
      await this.queueAll();
    });
  }

  async queueAll(): Promise<{ forecasts: number; anomalies: number; cashflows: number }> {
    const counts = { forecasts: 0, anomalies: 0, cashflows: 0 };
    const since = new Date(Date.now() - FRESH_FOR_MS);
    await forEachTenant(
      this.dataSource,
      async (organizationId) => {
        if (
          (await this.entitlements.checkFeature(organizationId, 'ai_forecasting')) &&
          !(await this.runs.ranSince(organizationId, 'FORECAST', since))
        ) {
          await this.runs.request(organizationId, 'FORECAST', 'SCHEDULED', null);
          counts.forecasts++;
        }
        if (
          (await this.entitlements.checkFeature(organizationId, 'ai_anomalies')) &&
          !(await this.runs.ranSince(organizationId, 'ANOMALY', since))
        ) {
          await this.runs.request(organizationId, 'ANOMALY', 'SCHEDULED', null);
          counts.anomalies++;
        }
        if (
          (await this.entitlements.checkFeature(organizationId, 'ai_cashflow')) &&
          !(await this.runs.ranSince(organizationId, 'CASHFLOW', since))
        ) {
          // Inside the tenant's context: today's cash is read from its ledger.
          await this.cashflow.refresh(organizationId, null, 'SCHEDULED');
          counts.cashflows++;
        }
      },
      undefined,
      (organizationId, error) =>
        this.logger.error(`Nightly AI runs could not be queued for ${organizationId}: ${(error as Error)?.message}`),
    );
    this.logger.log(
      `Nightly AI runs queued: ${counts.forecasts} forecast, ${counts.anomalies} anomaly, ${counts.cashflows} cash flow.`,
    );
    return counts;
  }
}
