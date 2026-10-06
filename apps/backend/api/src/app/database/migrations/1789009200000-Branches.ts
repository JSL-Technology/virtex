import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Branches: the places a company operates from, distinct from the legal entities it owns.
 *
 * Until now the product had subsidiaries (other legal entities, other books) and nothing else, so a
 * company with one tax id and three stores could not say where an invoice, a till sale or a goods
 * receipt happened. This adds:
 *
 *   - `branches`, tenant-isolated, at most one headquarters per company;
 *   - `user_branch_access`, the branches a person may work in (no rows = every branch);
 *   - `user_organizations.default_branch_id`, where a person's new documents come from;
 *   - `branch_id` on every document that is issued somewhere, and on warehouses.
 *
 * Every new column is nullable and nothing is backfilled: existing documents predate branches and
 * honestly have none, and a company that never sets branches up keeps working exactly as before.
 * A branch referenced by any document cannot be deleted — it is deactivated instead — because a
 * document must keep saying where it was issued.
 */
const DOCUMENT_TABLES = [
  'invoices',
  'quotes',
  'customer_payments',
  'vendor_bills',
  'payment_batches',
  'purchase_orders',
  'purchase_order_receipts',
  'pos_shifts',
  'pos_sales',
  'warehouses',
] as const;

const TENANT_PREDICATE = `organization_id = (NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

export class Branches1789009200000 implements MigrationInterface {
  name = 'Branches1789009200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "branches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "name" character varying(120) NOT NULL,
        "address" character varying(255),
        "city" character varying(120),
        "state" character varying(120),
        "postal_code" character varying(20),
        "phone" character varying(40),
        "fiscal_establishment_code" character varying(10),
        "emission_point_code" character varying(10),
        "default_warehouse_id" uuid,
        "is_headquarters" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_branches" PRIMARY KEY ("id"),
        CONSTRAINT "FK_branches_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_branches_org_code" ON "branches" ("organization_id", "code")`);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_branches_org_headquarters"
        ON "branches" ("organization_id") WHERE "is_headquarters" = true
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "user_branch_access" (
        "user_id" uuid NOT NULL,
        "branch_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_branch_access" PRIMARY KEY ("user_id", "branch_id"),
        CONSTRAINT "FK_user_branch_access_branch"
          FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_branch_access_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_branch_access_org_user"
        ON "user_branch_access" ("organization_id", "user_id")
    `);

    for (const table of ['branches', 'user_branch_access']) {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`CREATE POLICY tenant_isolation ON "${table}" USING (${TENANT_PREDICATE}) WITH CHECK (${TENANT_PREDICATE})`);
    }

    await q.query(`ALTER TABLE "user_organizations" ADD COLUMN IF NOT EXISTS "default_branch_id" uuid`);
    await q.query(`
      ALTER TABLE "user_organizations"
        ADD CONSTRAINT "FK_user_organizations_default_branch"
        FOREIGN KEY ("default_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL
    `);

    for (const table of DOCUMENT_TABLES) {
      await q.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "branch_id" uuid`);
      await q.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "FK_${table}_branch"
          FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT
      `);
      await q.query(`CREATE INDEX IF NOT EXISTS "IDX_${table}_org_branch" ON "${table}" ("organization_id", "branch_id")`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of DOCUMENT_TABLES) {
      await q.query(`DROP INDEX IF EXISTS "IDX_${table}_org_branch"`);
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_branch"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "branch_id"`);
    }
    await q.query(`ALTER TABLE "user_organizations" DROP CONSTRAINT IF EXISTS "FK_user_organizations_default_branch"`);
    await q.query(`ALTER TABLE "user_organizations" DROP COLUMN IF EXISTS "default_branch_id"`);
    await q.query(`DROP TABLE IF EXISTS "user_branch_access"`);
    await q.query(`DROP TABLE IF EXISTS "branches"`);
  }
}
