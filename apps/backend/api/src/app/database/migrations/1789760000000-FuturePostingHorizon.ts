import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How far ahead of the company's today a posting may be dated (FIN-JE-02).
 *
 * There was no limit, and a posting into a year with no calendar opened that fiscal year and its
 * twelve periods to receive it: a year mistyped by one opened a year. Thirty-one days by default —
 * next month's first days, never a year away — and never less than the end of the current period
 * (`resolvePostingPeriod`), so period-end entries always fit. A company changes it in Settings ›
 * Closing.
 */
export class FuturePostingHorizon1789760000000 implements MigrationInterface {
  name = 'FuturePostingHorizon1789760000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "max_future_posting_days" integer NOT NULL DEFAULT 31`);
    await q.query(
      `ALTER TABLE "organization_settings" ADD CONSTRAINT "CHK_organization_settings_max_future_posting_days" CHECK ("max_future_posting_days" BETWEEN 0 AND 366)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organization_settings" DROP CONSTRAINT IF EXISTS "CHK_organization_settings_max_future_posting_days"`);
    await q.query(`ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "max_future_posting_days"`);
  }
}
