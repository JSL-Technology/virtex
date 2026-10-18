import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A company's own units of measure, beside the shared catalogue (QA M-18).
 *
 * The platform catalogue — unit, kilogram, metre… — is global and stays so. But a business sells by
 * the «saco de 50 kg», the «bulto», the «caja de 12»: units nobody else needs, which the screen gave
 * no way to add. They live in their own tenant table, under the same row-level policy as the rest
 * of the product, keyed by a symbol unique within the company. Products reference units by symbol,
 * so a company unit is used exactly like a global one.
 */
export class TenantUnitsOfMeasure1789010400000 implements MigrationInterface {
  name = 'TenantUnitsOfMeasure1789010400000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_units_of_measure" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "symbol" varchar(16) NOT NULL,
        "name" varchar(80) NOT NULL,
        "category" varchar(32) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_units_of_measure" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_units_of_measure_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_units_of_measure_org_symbol"
        ON "tenant_units_of_measure" ("organization_id", "symbol")
    `);

    await q.query(`ALTER TABLE "tenant_units_of_measure" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "tenant_units_of_measure" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "tenant_units_of_measure"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "tenant_units_of_measure"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_units_of_measure" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "tenant_units_of_measure"`);
  }
}
