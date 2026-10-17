import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { EngineRunsService } from './engine-runs.service';
import { EntitlementsPort } from '../../saas/contracts/entitlements.contract';
import { SchedulerLockService } from '../../shared/scheduler/scheduler-lock.service';
import { forEachTenant } from '../../shared/tenancy/tenant-job';
import { CashflowService } from '../cashflow/cashflow.service';

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
  ) {}

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
