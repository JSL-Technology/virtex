import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Portal users are bound to the customer they are (audit 2026-10-31, CS-01).
 *
 * The customer portal answered every case and invoice of the tenant to anyone holding
 * `customer_portal:access`. This is the binding it lacked: one live row per user and tenant, tenant
 * isolated by RLS like every other tenant table.
 */
export class CustomerPortalAccounts1789380000000 implements MigrationInterface {
  name = 'CustomerPortalAccounts1789380000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "customer_portal_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "granted_by_user_id" uuid NULL,
        "granted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "revoked_at" TIMESTAMP WITH TIME ZONE NULL,
        "revoked_by_user_id" uuid NULL,
        CONSTRAINT "PK_customer_portal_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_portal_accounts_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_portal_accounts_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_portal_accounts_customer" FOREIGN KEY ("customer_id")
          REFERENCES "customers"("id") DEFERRABLE INITIALLY DEFERRED
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_portal_accounts_live_user"
        ON "customer_portal_accounts" ("organization_id", "user_id") WHERE "revoked_at" IS NULL
    `);
    await q.query(`ALTER TABLE "customer_portal_accounts" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "customer_portal_accounts" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "customer_portal_accounts"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "customer_portal_accounts"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE ON "customer_portal_accounts" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "customer_portal_accounts"`);
  }
}
