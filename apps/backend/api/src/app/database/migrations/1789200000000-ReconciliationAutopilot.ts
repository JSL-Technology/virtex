import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconciliation that applies what it is sure of, and learns how sure it may be.
 *
 *  - `reconciliation_account_settings`: per bank account, whether matches are confirmed without a
 *    person and from what score — over the company's setting — and whether that was paused
 *    because people kept undoing what it did.
 *  - `reconciliation_auto_outcomes`: each match confirmed without a person, with the score it had,
 *    and whether someone undid it. The undo rate by score is what calibrates the threshold.
 */
export class ReconciliationAutopilot1789200000000 implements MigrationInterface {
  name = 'ReconciliationAutopilot1789200000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "reconciliation_account_settings" (
        "organization_id" uuid NOT NULL,
        "bank_account_id" uuid NOT NULL,
        "auto_confirm" boolean NULL,
        "min_score" integer NULL,
        "paused_at" timestamptz NULL,
        "paused_reason" varchar(64) NULL,
        "updated_by_user_id" uuid NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reconciliation_account_settings" PRIMARY KEY ("organization_id", "bank_account_id"),
        CONSTRAINT "CHK_reconciliation_account_settings_min_score" CHECK ("min_score" IS NULL OR "min_score" BETWEEN 90 AND 100),
        CONSTRAINT "FK_reconciliation_account_settings_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reconciliation_account_settings_bank_account" FOREIGN KEY ("bank_account_id")
          REFERENCES "bank_accounts"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "reconciliation_auto_outcomes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "match_id" uuid NOT NULL,
        "bank_account_id" uuid NOT NULL,
        "statement_id" uuid NOT NULL,
        "score" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "undone_at" timestamptz NULL,
        "undone_by_user_id" uuid NULL,
        CONSTRAINT "PK_reconciliation_auto_outcomes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reconciliation_auto_outcomes_match" UNIQUE ("match_id"),
        CONSTRAINT "FK_reconciliation_auto_outcomes_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_reconciliation_auto_outcomes_account" ON "reconciliation_auto_outcomes" ("organization_id", "bank_account_id", "created_at")`,
    );
    for (const table of ['reconciliation_account_settings', 'reconciliation_auto_outcomes']) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
      `);
    }
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "reconciliation_account_settings", "reconciliation_auto_outcomes" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "reconciliation_auto_outcomes"`);
    await q.query(`DROP TABLE IF EXISTS "reconciliation_account_settings"`);
  }
}
