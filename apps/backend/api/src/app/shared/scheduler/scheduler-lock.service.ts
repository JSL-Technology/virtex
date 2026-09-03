import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Runs a unit of scheduled work exactly once, whichever replica's scheduler fires first.
 *
 * ## Why not an in-process flag
 *
 * That is what was there: `private isJobRunning = false` on the auto-reversal service. It is
 * correct for exactly one process and silently wrong for two, and there is no way to notice from
 * inside — the second replica's duplicate depreciation entry looks like an ordinary posting.
 *
 * ## Why not an advisory lock
 *
 * A Postgres advisory lock gives mutual exclusion for the duration of the run, which prevents two
 * replicas colliding but not the same replica running the same month's depreciation again tomorrow.
 * The durable row does both: the claim is the lock while the job runs, and the record afterwards is
 * what makes it idempotent. Depreciation being posted nightly instead of monthly — which fully
 * depreciated a five-year asset in about two months — was the second problem, not the first.
 */
@Injectable()
export class SchedulerLockService {
  private readonly logger = new Logger(SchedulerLockService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Claim `runKey` for `jobName` and run `work` if the claim succeeds.
   *
   * @returns true when this process ran the work, false when someone else already had it.
   *
   * A failure releases the claim, so the next scheduled firing retries. A success leaves the row,
   * so it never runs again for that key.
   */
  async runOnce(
    jobName: string,
    runKey: string,
    work: () => Promise<void>,
  ): Promise<boolean> {
    const claimed = await this.dataSource.query<{ run_key: string }[]>(
      `INSERT INTO "scheduled_job_runs" ("job_name", "run_key", "started_at")
       VALUES ($1, $2, now())
       ON CONFLICT ("job_name", "run_key") DO NOTHING
       RETURNING "run_key"`,
      [jobName, runKey],
    );

    if (claimed.length === 0) {
      this.logger.debug(`${jobName}[${runKey}] ya fue ejecutado o está en curso; se omite.`);
      return false;
    }

    try {
      await work();
      await this.dataSource.query(
        `UPDATE "scheduled_job_runs" SET "finished_at" = now()
         WHERE "job_name" = $1 AND "run_key" = $2`,
        [jobName, runKey],
      );
      return true;
    } catch (error) {
      // Release the claim so the next firing retries, rather than recording a permanent success
      // for work that did not happen.
      await this.dataSource.query(
        `DELETE FROM "scheduled_job_runs" WHERE "job_name" = $1 AND "run_key" = $2`,
        [jobName, runKey],
      );
      this.logger.error(
        `${jobName}[${runKey}] falló y fue liberado para reintento: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /** Whether a key has already completed. For callers that need to check without claiming. */
  async hasRun(jobName: string, runKey: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ run_key: string }[]>(
      `SELECT "run_key" FROM "scheduled_job_runs"
       WHERE "job_name" = $1 AND "run_key" = $2 AND "finished_at" IS NOT NULL`,
      [jobName, runKey],
    );
    return rows.length > 0;
  }
}
