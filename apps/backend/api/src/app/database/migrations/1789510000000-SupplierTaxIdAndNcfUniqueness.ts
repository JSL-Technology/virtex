import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A supplier's tax id, and a supplier's fiscal document, are unique in the database (audit
 * 2026-11-07, CMP-03, CMP-04).
 *
 * Two suppliers could share an RNC, and the NCF check ran per `vendor_id`, so the same NCF was
 * accepted on the duplicate supplier and the 606 reported one purchase twice. The NCF check was
 * also only an advisory lock in the service: an import or direct SQL skipped it.
 *
 *  - `suppliers.tax_id_key`: the tax id reduced to letters and digits, upper case, kept by a
 *    trigger; unique per organization.
 *  - `vendor_bills.issuer_tax_key` (the issuer's key when the bill was recorded, a snapshot — the
 *    supplier's later correction does not rewrite filed bills) and `vendor_bills.ncf_key` (the
 *    document number normalized the same way), kept by a trigger; one live bill per (organization,
 *    issuer, document number). Voided and rejected bills leave the index, as with the supplier
 *    invoice number.
 *
 * The migration refuses to run if existing data already violates either rule, listing the
 * offenders, rather than hiding them: deciding which duplicate is the real one is the tenant's call.
 */
export class SupplierTaxIdAndNcfUniqueness1789510000000 implements MigrationInterface {
  name = 'SupplierTaxIdAndNcfUniqueness1789510000000';

  public async up(q: QueryRunner): Promise<void> {
    const key = (column: string) => `NULLIF(upper(regexp_replace(coalesce(${column}, ''), '[^0-9A-Za-z]', '', 'g')), '')`;

    await q.query(`ALTER TABLE "suppliers" ADD COLUMN "tax_id_key" character varying(40)`);
    await q.query(`UPDATE "suppliers" SET "tax_id_key" = ${key('"taxId"')}`);
    await q.query(`
      CREATE OR REPLACE FUNCTION virtex_suppliers_tax_id_key() RETURNS trigger AS $$
      BEGIN
        NEW."tax_id_key" := ${key('NEW."taxId"')};
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await q.query(`
      CREATE TRIGGER "TR_suppliers_tax_id_key" BEFORE INSERT OR UPDATE OF "taxId" ON "suppliers"
        FOR EACH ROW EXECUTE FUNCTION virtex_suppliers_tax_id_key()`);

    const dupSuppliers = await q.query(`
      SELECT "organization_id", "tax_id_key", count(*)::int AS n FROM "suppliers"
       WHERE "tax_id_key" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1`);
    if (dupSuppliers.length) {
      throw new Error(`CMP-03: suppliers share a tax id; merge them before migrating: ${JSON.stringify(dupSuppliers)}`);
    }
    await q.query(`
      CREATE UNIQUE INDEX "UQ_suppliers_org_tax_id_key" ON "suppliers" ("organization_id", "tax_id_key")
       WHERE "tax_id_key" IS NOT NULL`);

    await q.query(`ALTER TABLE "vendor_bills" ADD COLUMN "issuer_tax_key" character varying(40), ADD COLUMN "ncf_key" character varying(40)`);
    await q.query(`
      UPDATE "vendor_bills" b SET "ncf_key" = ${key('b."ncf"')},
             "issuer_tax_key" = (SELECT s."tax_id_key" FROM "suppliers" s WHERE s."id" = b."vendor_id")`);
    await q.query(`
      CREATE OR REPLACE FUNCTION virtex_vendor_bills_fiscal_keys() RETURNS trigger AS $$
      BEGIN
        NEW."ncf_key" := ${key('NEW."ncf"')};
        IF TG_OP = 'INSERT' OR NEW."vendor_id" IS DISTINCT FROM OLD."vendor_id" THEN
          NEW."issuer_tax_key" := (SELECT s."tax_id_key" FROM "suppliers" s WHERE s."id" = NEW."vendor_id");
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await q.query(`
      CREATE TRIGGER "TR_vendor_bills_fiscal_keys" BEFORE INSERT OR UPDATE OF "ncf", "vendor_id" ON "vendor_bills"
        FOR EACH ROW EXECUTE FUNCTION virtex_vendor_bills_fiscal_keys()`);

    const dupBills = await q.query(`
      SELECT "organization_id", "issuer_tax_key", "ncf_key", count(*)::int AS n FROM "vendor_bills"
       WHERE "issuer_tax_key" IS NOT NULL AND "ncf_key" IS NOT NULL AND "status" NOT IN ('VOID', 'REJECTED')
       GROUP BY 1, 2, 3 HAVING count(*) > 1`);
    if (dupBills.length) {
      throw new Error(`CMP-03: one supplier document is recorded on several live bills; void the duplicates first: ${JSON.stringify(dupBills)}`);
    }
    await q.query(`
      CREATE UNIQUE INDEX "UQ_vendor_bills_issuer_ncf" ON "vendor_bills" ("organization_id", "issuer_tax_key", "ncf_key")
       WHERE "issuer_tax_key" IS NOT NULL AND "ncf_key" IS NOT NULL AND "status" NOT IN ('VOID', 'REJECTED')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_vendor_bills_issuer_ncf"`);
    await q.query(`DROP TRIGGER IF EXISTS "TR_vendor_bills_fiscal_keys" ON "vendor_bills"`);
    await q.query(`DROP FUNCTION IF EXISTS virtex_vendor_bills_fiscal_keys()`);
    await q.query(`ALTER TABLE "vendor_bills" DROP COLUMN "issuer_tax_key", DROP COLUMN "ncf_key"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_suppliers_org_tax_id_key"`);
    await q.query(`DROP TRIGGER IF EXISTS "TR_suppliers_tax_id_key" ON "suppliers"`);
    await q.query(`DROP FUNCTION IF EXISTS virtex_suppliers_tax_id_key()`);
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "tax_id_key"`);
  }
}
