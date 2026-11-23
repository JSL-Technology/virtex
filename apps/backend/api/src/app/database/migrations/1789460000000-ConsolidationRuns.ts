import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

/**
 * Consolidation runs, kept (audit 2026-11-07, FINB-34 and the "persistir corridas" step of FINB-30).
 *
 * A consolidation was computed on every request and thrown away: nothing could be reproduced,
 * reviewed or compared, and the cumulative translation reserve existed only as whatever the next
 * computation produced. Each run is now stored with who ran it, the period, the headline figures
 * (to list and compare runs without opening the document) and the full statements as computed.
 * Append-only: a run is a record; a new one supersedes it, it is never edited.
 */
export class ConsolidationRuns1789460000000 implements MigrationInterface {
  name = 'ConsolidationRuns1789460000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "consolidation_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "start_date" date NOT NULL,
        "as_of_date" date NOT NULL,
        "presentation_currency" varchar(3) NOT NULL,
        "is_balanced" boolean NOT NULL,
        "total_assets" numeric(18,2) NOT NULL,
        "total_equity" numeric(18,2) NOT NULL,
        "non_controlling_interests" numeric(18,2) NOT NULL,
        "goodwill" numeric(18,2) NOT NULL,
        "translation_reserve" numeric(18,2) NOT NULL,
        "net_income" numeric(18,2) NOT NULL,
        "warning_count" integer NOT NULL,
        "result" jsonb NOT NULL,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_consolidation_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_consolidation_runs_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_consolidation_runs_period" CHECK ("start_date" <= "as_of_date")
      )
    `);
    await q.query(`CREATE INDEX "IDX_consolidation_runs_org_date" ON "consolidation_runs" ("organization_id", "as_of_date", "created_at")`);
    await q.query(`ALTER TABLE "consolidation_runs" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "consolidation_runs" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "consolidation_runs"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    // Append-only: the application may read and add runs, never rewrite one.
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT ON "consolidation_runs" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "consolidation_runs"`);
  }
}
