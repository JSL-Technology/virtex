import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scheduled work is claimed before it runs, and depreciation remembers where it got to.
 *
 * Twelve `@Cron` declarations had no coordination between processes. The only guard anywhere was a
 * boolean field in the auto-reversal service's memory, which does nothing once there is a second
 * API replica — the normal shape of any commercial deployment. With two replicas, monthly
 * depreciation posted twice and every accrual was reversed twice.
 *
 * `scheduled_job_runs` is the claim: an `INSERT … ON CONFLICT DO NOTHING` keyed by job and run,
 * where the run key is usually tenant plus period. Because the row is durable it also makes the
 * work idempotent across restarts, which matters more than the replica problem did: the
 * depreciation cron was declared `EVERY_DAY_AT_2AM` on a method named `runMonthlyDepreciation`, so
 * it charged a full month every night and wrote a five-year asset down in about two months.
 *
 * `fixed_assets.depreciated_through` is the per-asset half of the same guarantee, so an asset
 * picked up by both the scheduler and the period close is charged once.
 */
export class SchedulerClaims1788700100000 implements MigrationInterface {
  name = 'SchedulerClaims1788700100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scheduled_job_runs" (
        "job_name" character varying(80) NOT NULL,
        "run_key" character varying(200) NOT NULL,
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "error" text,
        CONSTRAINT "PK_scheduled_job_runs" PRIMARY KEY ("job_name", "run_key")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_scheduled_job_runs_job_started"
      ON "scheduled_job_runs" ("job_name", "started_at")
    `);

    await queryRunner.query(
      `ALTER TABLE "fixed_asset" ADD COLUMN IF NOT EXISTS "depreciated_through" date`,
    );

    // Existing assets are marked as depreciated through the end of last month, so the first run
    // after this migration charges the current month and not every month since acquisition.
    await queryRunner.query(`
      UPDATE "fixed_asset"
      SET "depreciated_through" = (date_trunc('month', CURRENT_DATE) - INTERVAL '1 day')::date
      WHERE "depreciated_through" IS NULL
        AND "accumulated_depreciation" > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fixed_asset" DROP COLUMN IF EXISTS "depreciated_through"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scheduled_job_runs_job_started"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "scheduled_job_runs"`);
  }
}
