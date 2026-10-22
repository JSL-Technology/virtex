import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What each company decides about its AI (`ai_organization_settings`), and the receipts that let
 * every call be traced and budgeted (`ai_requests`).
 *
 * Until now a company on a paid plan could not turn the AI off, could not choose which features
 * send its data to a model provider, and had no spending limit beyond the plan's credits — which
 * the top tier had unlimited. A company's settings now say:
 *
 *  - `language_models`: whether anything is sent to a language-model provider at all;
 *  - `disabled_features`: features it switched off one by one;
 *  - `scheduled_reports`: whether the monthly report is written unasked (off until opted in: it
 *    sends the company's statements to the provider without anyone pressing a button);
 *  - `image_embeddings`: whether product photos go to the embeddings provider (off until opted in);
 *  - `monthly_budget_usd` / `daily_budget_usd`: a hard limit in money, under the platform's ceiling;
 *  - `conversation_retention_days`: how long assistant conversations are kept;
 *  - `mask_identifiers`: whether tax identifiers, e-mails and bank numbers are masked in what the
 *    assistant's tools send to the provider when the answer does not need them.
 *
 * A company with no row has the defaults. `ai_requests` gains the prompt each call used (its id and
 * a hash of its text), so a bad answer can be traced to the exact instructions that produced it.
 */
export class AiOrganizationSettings1789160000000 implements MigrationInterface {
  name = 'AiOrganizationSettings1789160000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_organization_settings" (
        "organization_id" uuid NOT NULL,
        "language_models" boolean NOT NULL DEFAULT true,
        "disabled_features" jsonb NOT NULL DEFAULT '[]',
        "scheduled_reports" boolean NOT NULL DEFAULT false,
        "image_embeddings" boolean NOT NULL DEFAULT false,
        "monthly_budget_usd" numeric(12,2) NULL,
        "daily_budget_usd" numeric(12,2) NULL,
        "conversation_retention_days" integer NOT NULL DEFAULT 180,
        "mask_identifiers" boolean NOT NULL DEFAULT true,
        "budget_alerts" jsonb NOT NULL DEFAULT '{}',
        "updated_by_user_id" uuid NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_organization_settings" PRIMARY KEY ("organization_id"),
        CONSTRAINT "CHK_ai_organization_settings_retention" CHECK ("conversation_retention_days" BETWEEN 1 AND 3650),
        CONSTRAINT "CHK_ai_organization_settings_budgets" CHECK (
          ("monthly_budget_usd" IS NULL OR "monthly_budget_usd" >= 0) AND ("daily_budget_usd" IS NULL OR "daily_budget_usd" >= 0)
        ),
        CONSTRAINT "FK_ai_organization_settings_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`ALTER TABLE "ai_organization_settings" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "ai_organization_settings" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "ai_organization_settings"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "ai_organization_settings"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_organization_settings" TO virtex_app;
        END IF;
      END
      $$;
    `);

    await q.query(`ALTER TABLE "ai_requests" ADD COLUMN IF NOT EXISTS "prompt_id" varchar(64) NULL`);
    await q.query(`ALTER TABLE "ai_requests" ADD COLUMN IF NOT EXISTS "prompt_hash" char(16) NULL`);
    // The budget check sums this month's cost per company on every call.
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_requests_org_created" ON "ai_requests" ("organization_id", "created_at")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_ai_requests_org_created"`);
    await q.query(`ALTER TABLE "ai_requests" DROP COLUMN IF EXISTS "prompt_hash"`);
    await q.query(`ALTER TABLE "ai_requests" DROP COLUMN IF EXISTS "prompt_id"`);
    await q.query(`DROP TABLE IF EXISTS "ai_organization_settings"`);
  }
}
