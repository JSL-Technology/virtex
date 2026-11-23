import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Depreciation runs as documents (audit 2026-11-07, FINB-17).
 *
 * A run left no record of its own: its entries carried the reason «monthly-depreciation» whoever
 * had run it — the monthly job, a period close or a person at the board — and nothing tied an entry
 * to the run that posted it, nor the run to what it charged. `fixed_asset_depreciation_runs` holds
 * each run that charged something: the month it charged through, what set it going, who ran it,
 * and its totals. Each asset-month it charged points to it (`fixed_asset_depreciations.run_id`).
 *
 * The months charged before this migration keep a null run: which of the three ran them was never
 * written down, and this does not invent it. A run is history, so the application may add one and
 * read it, never change it or remove it.
 */
export class DepreciationRuns1789790000000 implements MigrationInterface {
  name = 'DepreciationRuns1789790000000';

  public async up(q: QueryRunner): Promise<void> {
    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;
    const appRole = async (statement: string) => {
      await q.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN ${statement}; END IF;
        END $$`);
    };

    await q.query(`
      CREATE TABLE "fixed_asset_depreciation_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "period_end" date NOT NULL,
        "trigger" character varying(20) NOT NULL,
        "fixed_asset_id" uuid,
        "ran_by_user_id" uuid,
        "asset_count" integer NOT NULL,
        "charge_count" integer NOT NULL,
        "total" numeric(18,2) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fixed_asset_depreciation_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fixed_asset_depreciation_runs_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_fixed_asset_depreciation_runs_asset" FOREIGN KEY ("fixed_asset_id")
          REFERENCES "fixed_asset"("id") ON DELETE NO ACTION,
        CONSTRAINT "CHK_fixed_asset_depreciation_runs_trigger"
          CHECK ("trigger" IN ('SCHEDULE', 'PERIOD_CLOSE', 'MANUAL', 'DISPOSAL')),
        CONSTRAINT "CHK_fixed_asset_depreciation_runs_disposal_asset"
          CHECK (("trigger" = 'DISPOSAL') = ("fixed_asset_id" IS NOT NULL)),
        CONSTRAINT "CHK_fixed_asset_depreciation_runs_totals"
          CHECK ("asset_count" > 0 AND "charge_count" >= "asset_count" AND "total" > 0)
      )`);
    await q.query(`
      CREATE INDEX "IDX_fixed_asset_depreciation_runs_org_created"
        ON "fixed_asset_depreciation_runs" ("organization_id", "created_at")`);
    await q.query(`ALTER TABLE "fixed_asset_depreciation_runs" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "fixed_asset_depreciation_runs" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "fixed_asset_depreciation_runs"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "fixed_asset_depreciation_runs"
        USING ("organization_id" = ${setting}::uuid)
        WITH CHECK ("organization_id" = ${setting}::uuid)`);
    await appRole(
      `GRANT SELECT, INSERT ON "fixed_asset_depreciation_runs" TO virtex_app; REVOKE UPDATE, DELETE ON "fixed_asset_depreciation_runs" FROM virtex_app`,
    );

    await q.query(`ALTER TABLE "fixed_asset_depreciations" ADD COLUMN "run_id" uuid`);
    await q.query(`
      ALTER TABLE "fixed_asset_depreciations"
        ADD CONSTRAINT "FK_fixed_asset_depreciations_run" FOREIGN KEY ("run_id")
          REFERENCES "fixed_asset_depreciation_runs"("id") ON DELETE NO ACTION`);
    await q.query(`CREATE INDEX "IDX_fixed_asset_depreciations_run" ON "fixed_asset_depreciations" ("run_id")`);

    // The references above join rows of one company to rows of the same company, and the guard
    // that says so is installed for every such key by name.
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const constraint of ['FK_fixed_asset_depreciations_run', 'FK_fixed_asset_depreciation_runs_asset']) {
      const table = constraint === 'FK_fixed_asset_depreciations_run' ? 'fixed_asset_depreciations' : 'fixed_asset_depreciation_runs';
      await q.query(`
        DO $$ BEGIN
          EXECUTE format('DROP TRIGGER IF EXISTS %I ON "${table}"', 'tg_same_tenant_' || substr(md5('${constraint}'), 1, 24));
        END $$`);
    }
    await q.query(`DROP INDEX IF EXISTS "IDX_fixed_asset_depreciations_run"`);
    await q.query(`ALTER TABLE "fixed_asset_depreciations" DROP CONSTRAINT IF EXISTS "FK_fixed_asset_depreciations_run"`);
    await q.query(`ALTER TABLE "fixed_asset_depreciations" DROP COLUMN IF EXISTS "run_id"`);
    await q.query(`DROP TABLE IF EXISTS "fixed_asset_depreciation_runs"`);
  }
}
