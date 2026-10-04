import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The bank catalogue: institutions as a master of their own.
 *
 * «Bancos» was a page deducing its rows from the `bank_name` typed into each bank account, with no
 * table behind it. This gives the institution a row — name, SWIFT/BIC, country, local clearing
 * code — that bank accounts reference.
 *
 * Nothing a tenant already sees is lost: every distinct bank name already on a bank account becomes
 * a catalogue entry (with that account's BIC when one was recorded), and the account is linked to
 * it. Tenant-isolated like every tenant table, erased with its tenant; a bank still referenced by
 * an account cannot be deleted, because the account would silently lose its institution.
 */
export class BankCatalogue1789009000000 implements MigrationInterface {
  name = 'BankCatalogue1789009000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "banks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "swift_bic" character varying(11),
        "country_code" character varying(2),
        "local_code" character varying(20),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_banks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_banks_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_banks_org_name" ON "banks" ("organization_id", "name")`);

    const predicate = `organization_id = (NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`ALTER TABLE "banks" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "banks" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "banks"`);
    await q.query(`CREATE POLICY tenant_isolation ON "banks" USING (${predicate}) WITH CHECK (${predicate})`);

    await q.query(`ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "bank_id" uuid`);
    await q.query(`
      ALTER TABLE "bank_accounts"
        ADD CONSTRAINT "FK_bank_accounts_bank"
        FOREIGN KEY ("bank_id") REFERENCES "banks"("id") ON DELETE RESTRICT
    `);

    // The banks the tenant already named, one entry per distinct (trimmed) name. The BIC is the
    // first one recorded for that name, if any — enough to start from; the tenant can correct it.
    await q.query(`
      INSERT INTO "banks" ("organization_id", "name", "swift_bic")
      SELECT DISTINCT ON (a."organization_id", btrim(a."bank_name"))
             a."organization_id", btrim(a."bank_name"), NULLIF(btrim(a."swift_bic"), '')
        FROM "bank_accounts" a
       WHERE NULLIF(btrim(a."bank_name"), '') IS NOT NULL
       ORDER BY a."organization_id", btrim(a."bank_name"), a."swift_bic" NULLS LAST
      ON CONFLICT ("organization_id", "name") DO NOTHING
    `);
    await q.query(`
      UPDATE "bank_accounts" a
         SET "bank_id" = b."id"
        FROM "banks" b
       WHERE b."organization_id" = a."organization_id"
         AND b."name" = btrim(a."bank_name")
         AND a."bank_id" IS NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "bank_accounts" DROP CONSTRAINT IF EXISTS "FK_bank_accounts_bank"`);
    await q.query(`ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "bank_id"`);
    await q.query(`DROP TABLE IF EXISTS "banks"`);
  }
}
