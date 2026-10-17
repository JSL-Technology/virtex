import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { AiModelRun, AiModelRunKind, AiModelRunTrigger } from '../entities/ai-model-run.entity';

/** The queue the Python engine (`apps/ai-engine`) consumes. */
export const AI_ENGINE_QUEUE = 'ai-engine';

/** A run older than this that never finished died with its worker; it is marked failed, not waited on. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** The payload of every engine job. The engine sets the tenant from `organizationId` before reading. */
export interface EngineJobData {
  organizationId: string;
  runId: string;
  kind: AiModelRunKind;
  params: Record<string, unknown>;
}

/** Defaults the engine reads from the run's `params`; documented in apps/ai-engine/README.md. */
export const FORECAST_DEFAULTS = {
  horizonDays: 90,
  serviceLevel: 0.95,
  historyDays: 730,
  /** Lead time assumed for a product with no receipts to measure one from. */
  defaultLeadTimeDays: 7,
  /** Days of cover above which stock counts as excess. */
  overstockCoverDays: 120,
} as const;

export const ANOMALY_DEFAULTS = {
  lookbackDays: 90,
} as const;

/**
 * Starting forecasting and anomaly runs, and knowing what became of them.
 *
 * The API never computes a forecast itself. It records the run, hands the engine a job naming it,
 * and reads the results the engine writes back — so a slow or failed engine costs the screens
 * their freshness, never their availability: the last good results stay readable.
 */
@Injectable()
export class EngineRunsService {
  private readonly logger = new Logger(EngineRunsService.name);

  constructor(
    @InjectRepository(AiModelRun) private readonly runs: Repository<AiModelRun>,
    @InjectQueue(AI_ENGINE_QUEUE) private readonly queue: Queue<EngineJobData>,
  ) {}

  /**
   * Queue a run, unless one of the same kind is already queued or running for the tenant — two
   * runs racing to replace the same results would only waste compute and confuse the screen.
   */
  async request(
    organizationId: string,
    kind: AiModelRunKind,
    trigger: AiModelRunTrigger,
    requestedByUserId: string | null,
  ): Promise<AiModelRun> {
    await this.expireStale(organizationId);
    const active = await this.runs.findOne({
      where: { organizationId, kind, status: In(['QUEUED', 'RUNNING']) },
      order: { createdAt: 'DESC' },
    });
    if (active) return active;

    const params: Record<string, unknown> =
      kind === 'FORECAST' ? { ...FORECAST_DEFAULTS } : { ...ANOMALY_DEFAULTS };
    const run = await this.runs.save(
      this.runs.create({ organizationId, kind, trigger, requestedByUserId, status: 'QUEUED', params }),
    );

    try {
      await this.queue.add(
        kind === 'FORECAST' ? 'forecast' : 'anomalies',
        { organizationId, runId: run.id, kind, params },
        {
          // The run id deduplicates the enqueue; the engine deduplicates the execution by refusing
          // to start a run that is no longer QUEUED.
          jobId: run.id,
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    } catch (error) {
      run.status = 'FAILED';
      run.error = `enqueue failed: ${(error as Error).message}`;
      run.finishedAt = new Date();
      await this.runs.save(run);
      this.logger.error(`Could not enqueue ${kind} run for ${organizationId}: ${(error as Error).message}`);
    }
    return run;
  }

  latest(organizationId: string, kind: AiModelRunKind): Promise<AiModelRun | null> {
    return this.runs.findOne({ where: { organizationId, kind }, order: { createdAt: 'DESC' } });
  }

  latestSucceeded(organizationId: string, kind: AiModelRunKind): Promise<AiModelRun | null> {
    return this.runs.findOne({
      where: { organizationId, kind, status: 'SUCCEEDED' },
      order: { finishedAt: 'DESC' },
    });
  }

  /** Whether a scheduled run of this kind already happened recently enough to skip tonight's. */
  async ranSince(organizationId: string, kind: AiModelRunKind, since: Date): Promise<boolean> {
    return (await this.runs.count({ where: { organizationId, kind, createdAt: MoreThan(since) } })) > 0;
  }

  private async expireStale(organizationId: string): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const stale = await this.runs.find({
      where: { organizationId, status: In(['QUEUED', 'RUNNING']), createdAt: LessThan(cutoff) },
    });
    for (const run of stale) {
      run.status = 'FAILED';
      run.error = run.error ?? 'expired: the engine did not finish this run';
      run.finishedAt = new Date();
    }
    if (stale.length) await this.runs.save(stale);
  }
}
