import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Projected cash flow, what-if scenarios, and written reports.
 *
 *  - `ai_cashflow_forecasts`: the daily balance band (P10/P50/P90) of a CASHFLOW or SCENARIO run,
 *    with the expected inflow, outflow and their components. Written by the engine.
 *  - `ai_cashflow_items`: each open receivable and payable of the projection with when it is likely
 *    to move (by 7 days, by 30, within the horizon) — what collections works from.
 *  - `ai_reports`: texts a model writes from facts the API assembled (the cash plan, the manager's
 *    monthly report), generated asynchronously and kept with the facts they were written from.
 *
 * The engine role may also now read what the projection needs: customer payment lines, suppliers
 * (names) and payroll runs (amounts and pay days).
 */
export class AiCashflow1789080000000 implements MigrationInterface {
  name = 'AiCashflow1789080000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_cashflow_forecasts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "day" date NOT NULL,
        "p10" numeric(18,2) NOT NULL,
        "p50" numeric(18,2) NOT NULL,
        "p90" numeric(18,2) NOT NULL,
        "inflow" numeric(18,2) NOT NULL DEFAULT 0,
        "outflow" numeric(18,2) NOT NULL DEFAULT 0,
        "components" jsonb NOT NULL DEFAULT '{}',
        CONSTRAINT "PK_ai_cashflow_forecasts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_cashflow_forecasts_run_day" UNIQUE ("run_id", "day"),
        CONSTRAINT "FK_ai_cashflow_forecasts_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_cashflow_forecasts_run" FOREIGN KEY ("run_id")
          REFERENCES "ai_model_runs"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_cashflow_forecasts_org_run" ON "ai_cashflow_forecasts" ("organization_id", "run_id")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_cashflow_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "kind" varchar(16) NOT NULL,
        "document_id" uuid NOT NULL,
        "party_id" uuid NULL,
        "party_name" varchar(300) NOT NULL DEFAULT '',
        "number" varchar(64) NULL,
        "due_date" date NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "expected_date" date NULL,
        "p_by_7" numeric(6,4) NOT NULL,
        "p_by_30" numeric(6,4) NOT NULL,
        "p_in_horizon" numeric(6,4) NOT NULL,
        "doubtful" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_ai_cashflow_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_cashflow_items_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_cashflow_items_run" FOREIGN KEY ("run_id")
          REFERENCES "ai_model_runs"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_cashflow_items_org_run_kind" ON "ai_cashflow_items" ("organization_id", "run_id", "kind")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_reports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "kind" varchar(32) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'QUEUED',
        "period" varchar(16) NULL,
        "source_run_id" uuid NULL,
        "language" varchar(8) NOT NULL DEFAULT 'es',
        "facts" jsonb NULL,
        "content" jsonb NULL,
        "error" text NULL,
        "requested_by_user_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz NULL,
        CONSTRAINT "PK_ai_reports" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ai_reports_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_reports_org_kind_created" ON "ai_reports" ("organization_id", "kind", "created_at")
    `);

    for (const table of ['ai_cashflow_forecasts', 'ai_cashflow_items', 'ai_reports']) {
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
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_ai_engine') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_cashflow_forecasts", "ai_cashflow_items" TO virtex_ai_engine;
          GRANT SELECT ON "customer_payment_lines", "suppliers", "payroll_runs" TO virtex_ai_engine;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_cashflow_forecasts", "ai_cashflow_items", "ai_reports" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ai_reports"`);
    await q.query(`DROP TABLE IF EXISTS "ai_cashflow_items"`);
    await q.query(`DROP TABLE IF EXISTS "ai_cashflow_forecasts"`);
  }
}
