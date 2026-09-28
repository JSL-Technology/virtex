import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reference data shared by every tenant is written by the platform, not by a tenant.
 *
 * Four shared tables were writable through tenant routes, behind permissions that any tenant
 * administrator's `'*'` satisfies:
 *
 *  - `currency` and `unit_of_measure`: a tenant could create, rename and delete rows every other
 *    tenant reads;
 *  - `exchange_rate`: recording a rate by hand wrote the shared table, so one customer's typo
 *    changed how every customer's foreign invoices converted;
 *  - `payroll_statutory_*` and `payroll_income_tax_brackets`: the contribution rates and tax scale
 *    every tenant's payroll is computed with.
 *
 * The routes now require platform permissions, which no tenant role can hold; this migration adds
 * them to the seeded Platform Operations role. What a tenant legitimately needs — to record the
 * rate its own authority mandates — gets its own table, `tenant_exchange_rates`, under the tenant
 * isolation policy, which the rate resolver prefers for that tenant.
 */
export class PlatformReferenceData1789007300000 implements MigrationInterface {
  name = 'PlatformReferenceData1789007300000';

  // A literal snapshot, for the same reason as SeedPlatformOperationsRole1789006900000.
  private static readonly NEW_PERMISSIONS = [
    'platform:reference_data:manage',
    'platform:exchange_rates:refresh',
    'platform:payroll:statutory_manage',
  ];

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "tenant_exchange_rates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "from_currency" character varying(3) NOT NULL,
        "to_currency" character varying(3) NOT NULL,
        "rate" numeric(18,6) NOT NULL,
        "date" date NOT NULL,
        "rate_type" "exchange_rate_rate_type_enum" NOT NULL DEFAULT 'OFFICIAL',
        "source" character varying(32) NOT NULL DEFAULT 'MANUAL',
        "recorded_by_user_id" uuid NULL,
        CONSTRAINT "PK_tenant_exchange_rates" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_exchange_rates_org" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_exchange_rates_pair_date_type"
        ON "tenant_exchange_rates" ("organization_id", "from_currency", "to_currency", "date", "rate_type")
    `);

    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;
    await q.query(`ALTER TABLE "tenant_exchange_rates" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "tenant_exchange_rates" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "tenant_exchange_rates"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "tenant_exchange_rates"
        USING ("organization_id" = ${setting}::uuid)
        WITH CHECK ("organization_id" = ${setting}::uuid)
    `);

    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_exchange_rates" TO virtex_app;
        END IF;
      END
      $$;
    `);

    // Existing hand-entered rows in the shared table stay where they are: which tenant typed each
    // one was never recorded beyond the user, and moving them would silently change how every
    // tenant's history converts. From here on, hand entry goes to the tenant's own table.

    for (const permission of PlatformReferenceData1789007300000.NEW_PERMISSIONS) {
      await q.query(
        `UPDATE "roles"
            SET "permissions" = CASE
                  WHEN "permissions" IS NULL OR "permissions" = '' THEN $1::text
                  ELSE "permissions" || ',' || $1::text
                END
          WHERE "organization_id" IS NULL
            AND "name" = 'Platform Operations'
            AND NOT ($1::text = ANY (string_to_array(COALESCE("permissions", ''), ',')))`,
        [permission],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const permission of PlatformReferenceData1789007300000.NEW_PERMISSIONS) {
      await q.query(
        `UPDATE "roles"
            SET "permissions" = array_to_string(array_remove(string_to_array("permissions", ','), $1::text), ',')
          WHERE "organization_id" IS NULL AND "name" = 'Platform Operations'`,
        [permission],
      );
    }
    await q.query(`DROP TABLE IF EXISTS "tenant_exchange_rates"`);
  }
}
