import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-company reconciliation settings: whether unambiguous matches are confirmed on import without
 * a person (off by default), and the score that counts as unambiguous. A match confirmed this way
 * is recorded with origin AUTOMATIC and undone like any other.
 */
export class ReconciliationSettings1789090000000 implements MigrationInterface {
  name = 'ReconciliationSettings1789090000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "reconciliation_settings" (
        "organization_id" uuid NOT NULL,
        "auto_confirm" boolean NOT NULL DEFAULT false,
        "min_score" integer NOT NULL DEFAULT 95,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reconciliation_settings" PRIMARY KEY ("organization_id"),
        CONSTRAINT "CHK_reconciliation_settings_min_score" CHECK ("min_score" BETWEEN 90 AND 100),
        CONSTRAINT "FK_reconciliation_settings_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`ALTER TABLE "reconciliation_settings" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "reconciliation_settings" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "reconciliation_settings"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "reconciliation_settings"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "reconciliation_settings" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "reconciliation_settings"`);
  }
}
