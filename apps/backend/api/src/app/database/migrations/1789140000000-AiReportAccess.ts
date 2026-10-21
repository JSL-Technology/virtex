import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who may read a written report (`ai_reports`).
 *
 * A report is written from facts other screens guard with their own permissions — the income
 * statement, the ageing, the cash position. Gating the report by a single `ai_reports:view` made
 * that one permission a back door to all of them. A report now records:
 *
 *  - `required_permissions`: the permissions of every source its facts came from. Reading it
 *    requires all of them, as reading the sources would.
 *  - `audience`: `REQUESTER` — written with the requester's own permissions and branches, readable
 *    by them only — or `ORGANIZATION` — written for the whole company (the scheduled report),
 *    readable only by someone who holds every source permission and is not limited to branches.
 *
 * Existing rows predate the rule: they are made `ORGANIZATION` with every permission a manager's
 * report can draw on, the strictest reading, so nothing written before becomes wider than it was.
 */
export class AiReportAccess1789140000000 implements MigrationInterface {
  name = 'AiReportAccess1789140000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ai_reports" ADD COLUMN IF NOT EXISTS "audience" varchar(16) NOT NULL DEFAULT 'REQUESTER'`);
    await q.query(`ALTER TABLE "ai_reports" ADD COLUMN IF NOT EXISTS "required_permissions" jsonb NOT NULL DEFAULT '[]'`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_ai_reports_audience') THEN
          ALTER TABLE "ai_reports" ADD CONSTRAINT "CHK_ai_reports_audience" CHECK ("audience" IN ('REQUESTER', 'ORGANIZATION'));
        END IF;
      END $$;
    `);
    await q.query(`
      UPDATE "ai_reports"
         SET "audience" = 'ORGANIZATION',
             "required_permissions" = '["reports:view_financial","treasury:view","accounts_receivable:view","accounts_payable:view","ai_cashflow:view","ai_collections:view","ai_anomalies:view","ai_forecasts:view","dashboard:view"]'::jsonb
       WHERE "required_permissions" = '[]'::jsonb
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ai_reports" DROP CONSTRAINT IF EXISTS "CHK_ai_reports_audience"`);
    await q.query(`ALTER TABLE "ai_reports" DROP COLUMN IF EXISTS "required_permissions"`);
    await q.query(`ALTER TABLE "ai_reports" DROP COLUMN IF EXISTS "audience"`);
  }
}
