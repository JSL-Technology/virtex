import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * One row per unit of scheduled work that has been claimed.
 *
 * ## What this replaces
 *
 * Twelve `@Cron` declarations, none with any coordination between processes. The only protection
 * anywhere was a boolean field on the auto-reversal service — in-process memory, so it does nothing
 * the moment there is more than one API replica, which is the normal shape of any commercial
 * deployment. With two replicas, monthly depreciation posted twice, automatic reversals doubled,
 * and the nightly balance rebuild raced itself.
 *
 * The claim is an `INSERT … ON CONFLICT DO NOTHING`: whoever inserts the row runs the work and
 * everybody else skips. Because the row is durable, it also makes the work idempotent across
 * restarts and redeploys — a job keyed `depreciation:<org>:2026-03` runs once for March however
 * many times the scheduler fires, which is what stopped depreciation being posted every night.
 */
@Entity({ name: 'scheduled_job_runs' })
@Index('IDX_scheduled_job_runs_job_started', ['jobName', 'startedAt'])
export class ScheduledJobRun {
  /** The job's stable name, e.g. `monthly-depreciation`. */
  @PrimaryColumn({ name: 'job_name', type: 'varchar', length: 80 })
  jobName: string;

  /**
   * What makes this run distinct — usually tenant and period, e.g. `<org-uuid>:2026-03`.
   *
   * Choosing the key is choosing the idempotency guarantee, so it belongs to the caller and not to
   * a timestamp taken here.
   */
  @PrimaryColumn({ name: 'run_key', type: 'varchar', length: 200 })
  runKey: string;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** Set when the run failed. The row is deleted on failure, so this is for in-flight diagnosis. */
  @Column({ name: 'error', type: 'text', nullable: true })
  error: string | null;
}
