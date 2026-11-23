import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

/** Landed costs applied to received goods (audit 2026-11-07, CMP-21). */
export class LandedCostAllocations1789550000000 implements MigrationInterface {
  name = 'LandedCostAllocations1789550000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "landed_cost_allocations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "landed_cost_id" uuid NOT NULL,
        "date" date NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "allocation_method" character varying(10) NOT NULL,
        "receipt_ids" uuid[] NOT NULL,
        "reference" character varying(120),
        "lines" jsonb NOT NULL,
        "status" character varying(8) NOT NULL DEFAULT 'POSTED',
        "journal_entry_id" uuid,
        "reversal_journal_entry_id" uuid,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_landed_cost_allocations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_landed_cost_allocations_amount" CHECK ("amount" > 0),
        CONSTRAINT "FK_landed_cost_allocations_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_landed_cost_allocations_landed_cost" FOREIGN KEY ("landed_cost_id") REFERENCES "landed_costs"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE INDEX "IDX_landed_cost_allocations_org" ON "landed_cost_allocations" ("organization_id", "date")`);
    await q.query(`ALTER TABLE "landed_cost_allocations" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "landed_cost_allocations" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "landed_cost_allocations"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})`);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "landed_cost_allocations" TO virtex_app;
        END IF;
      END
      $$`);
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "landed_cost_allocations"`);
  }
}
