import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A purchase records the supplier's document and what its own market asks about it
 * (docs/ARQUITECTURA_MERCADOS.md, phase 4).
 *
 * `vendor_bills` was a generic table with one market's columns. `ncf` held the number of the
 * supplier's document — the DGII's name for it — on a Mexican or Brazilian purchase too; and three
 * columns held DGII codes:
 *
 * - `purchase_category`, the 606's «tipo de bienes y servicios comprados», `NOT NULL DEFAULT '06'`,
 *   so every purchase in every market was classified as a Dominican merchandise purchase;
 * - `isr_retention_type`, the 606's kind of income-tax withholding;
 * - `payment_form`, the 606's «forma de pago», `NOT NULL DEFAULT '01'`.
 *
 * A market that asks for something else — the DIOT's kind of third party and operation — had nowhere
 * to put it, and the only answer was another column of another authority's codes.
 *
 * So: the document's number and the one it modifies take neutral names, what the authority asks is
 * `fiscal_attributes jsonb` by the keys the market declares (`MarketPurchases.fiscalAttributes`,
 * validated before anything is written), and how the purchase was paid is the company's own payment
 * method, as the sales side already records it — the authority's code for it lives on the method
 * (`payment_methods.fiscal_code`), not on every purchase.
 *
 * The codes already recorded keep their meaning: they move into the attributes under the keys the
 * Dominican market declares, and `payment_form` becomes the code of the payment method whose fiscal
 * code it is. Both directions are exact for every row the product wrote.
 *
 * Two more things were sized for one market and had to grow with the name:
 *
 * - `ncf_key`, the comparison key, was `varchar(40)` — an NCF is 19 characters. A Colombian CUFE is
 *   96 and a Brazilian NF-e access key 44, so the first purchase recorded in either market would
 *   have failed on insert with `value too long for type character varying(40)`; and
 *   `vendor_debit_note.ncf` was `varchar(19)`, the length of an NCF and of nothing else.
 * - `ai_src_posted_bills`, the view the AI engine reads, published the column as `ncf`. A view keeps
 *   its own column names when the table's are renamed, so it had to be rebuilt to publish the
 *   neutral name — and the engine's queries with it.
 */
export class NeutralPurchaseColumns1789630000000 implements MigrationInterface {
  name = 'NeutralPurchaseColumns1789630000000';

  /**
   * `ai_src_posted_bills` as the AI read contract (1789180000000) declares it, with the document
   * number's column named by the caller — a view cannot be renamed in place with
   * `CREATE OR REPLACE`, so it is rebuilt both ways.
   */
  private static readonly POSTED_BILLS_VIEW = (documentColumn: string): string => `
    SELECT b."organization_id", b."id", b."vendor_id", s."name" AS "vendor_name",
           b."supplier_fiscal_number" AS "${documentColumn}", b."date",
           b."dueDate" AS "due_date", b."total", b."total_in_base_currency", b."balance",
           (b."balance" * CASE WHEN b."total" > 0 THEN b."total_in_base_currency" / b."total" ELSE 1 END) AS "balance_in_base_currency",
           b."branch_id", b."purchase_order_id"
      FROM "vendor_bills" b
      LEFT JOIN "suppliers" s ON s."id" = b."vendor_id"
     WHERE b."voided_at" IS NULL AND b."status"::text NOT IN ('VOID', 'REJECTED', 'DRAFT')`;

  /** A rebuilt view is a new object: the read-only roles are granted it again. */
  private static readonly GRANT_POSTED_BILLS = `
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_ai_engine') THEN
        GRANT SELECT ON "ai_src_posted_bills" TO virtex_ai_engine;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
        GRANT SELECT ON "ai_src_posted_bills" TO virtex_app;
      END IF;
    END
    $$;`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── The supplier's document number, by its neutral name ────────────────────────────────
    await queryRunner.query(`DROP TRIGGER "TR_vendor_bills_fiscal_keys" ON "vendor_bills"`);
    await queryRunner.query(`DROP INDEX "UQ_vendor_bills_issuer_ncf"`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" RENAME COLUMN "ncf" TO "supplier_fiscal_number"`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" RENAME COLUMN "ncf_key" TO "supplier_fiscal_key"`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" RENAME COLUMN "ncf_modified" TO "modified_supplier_fiscal_number"`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION virtex_vendor_bills_fiscal_keys() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        NEW."supplier_fiscal_key" := NULLIF(upper(regexp_replace(coalesce(NEW."supplier_fiscal_number", ''), '[^0-9A-Za-z]', '', 'g')), '');
        IF TG_OP = 'INSERT' OR NEW."vendor_id" IS DISTINCT FROM OLD."vendor_id" THEN
          NEW."issuer_tax_key" := (SELECT s."tax_id_key" FROM "suppliers" s WHERE s."id" = NEW."vendor_id");
        END IF;
        RETURN NEW;
      END $fn$`);
    await queryRunner.query(`
      CREATE TRIGGER "TR_vendor_bills_fiscal_keys" BEFORE INSERT OR UPDATE OF "supplier_fiscal_number", "vendor_id"
        ON "vendor_bills" FOR EACH ROW EXECUTE FUNCTION virtex_vendor_bills_fiscal_keys()`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_vendor_bills_issuer_fiscal_number" ON "vendor_bills" ("organization_id", "issuer_tax_key", "supplier_fiscal_key")
        WHERE "issuer_tax_key" IS NOT NULL AND "supplier_fiscal_key" IS NOT NULL AND "status" NOT IN ('VOID', 'REJECTED')`);

    // ── What the market's authority asks about the purchase ────────────────────────────────
    await queryRunner.query(`ALTER TABLE "vendor_bills" ADD "fiscal_attributes" jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" ADD "payment_method_code" character varying(20)`);

    // Only a Dominican company's purchases carried these codes with meaning; elsewhere the two
    // defaults were written by the column, not by anybody's answer, and they say nothing.
    await queryRunner.query(`
      UPDATE "vendor_bills" b
         SET "fiscal_attributes" = jsonb_strip_nulls(
               jsonb_build_object(
                 'purchaseCategory', NULLIF(b."purchase_category", ''),
                 'isrRetentionType', NULLIF(b."isr_retention_type", '')
               )),
             "payment_method_code" = NULLIF(b."payment_form", '')
        FROM "organizations" o
       WHERE o."id" = b."organization_id" AND o."country" = 'DO'`);

    await queryRunner.query(`ALTER TABLE "vendor_bills" DROP COLUMN "purchase_category"`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" DROP COLUMN "isr_retention_type"`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" DROP COLUMN "payment_form"`);

    // ── Room for every market's number, not one market's ───────────────────────────────────
    // The key is the number with the punctuation dropped: 96 hexadecimal characters for a CUFE,
    // 44 digits for an NF-e access key. The index on it is rebuilt by the type change.
    await queryRunner.query(`ALTER TABLE "vendor_bills" ALTER COLUMN "supplier_fiscal_key" TYPE character varying(128)`);

    // ── A supplier's debit note carries the same number, under the same name ───────────────
    await queryRunner.query(`ALTER TABLE "vendor_debit_note" RENAME COLUMN "ncf" TO "supplier_fiscal_number"`);
    await queryRunner.query(`ALTER TABLE "vendor_debit_note" ALTER COLUMN "supplier_fiscal_number" TYPE character varying`);

    // ── What the AI engine reads, by the neutral name ──────────────────────────────────────
    await queryRunner.query(`DROP VIEW "ai_src_posted_bills"`);
    await queryRunner.query(`CREATE VIEW "ai_src_posted_bills" WITH (security_invoker = true) AS ${NeutralPurchaseColumns1789630000000.POSTED_BILLS_VIEW('supplier_fiscal_number')}`);
    await queryRunner.query(NeutralPurchaseColumns1789630000000.GRANT_POSTED_BILLS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW "ai_src_posted_bills"`);
    await queryRunner.query(`CREATE VIEW "ai_src_posted_bills" WITH (security_invoker = true) AS ${NeutralPurchaseColumns1789630000000.POSTED_BILLS_VIEW('ncf')}`);
    await queryRunner.query(NeutralPurchaseColumns1789630000000.GRANT_POSTED_BILLS);

    // Back to the lengths of one market's documents. A number longer than they hold was recorded
    // in a market the previous version could not store at all, so there is nothing to keep.
    await queryRunner.query(
      `ALTER TABLE "vendor_debit_note" ALTER COLUMN "supplier_fiscal_number" TYPE character varying(19)
         USING left("supplier_fiscal_number", 19)`,
    );
    await queryRunner.query(`ALTER TABLE "vendor_debit_note" RENAME COLUMN "supplier_fiscal_number" TO "ncf"`);
    await queryRunner.query(
      `ALTER TABLE "vendor_bills" ALTER COLUMN "supplier_fiscal_key" TYPE character varying(40) USING left("supplier_fiscal_key", 40)`,
    );

    await queryRunner.query(`ALTER TABLE "vendor_bills" ADD "purchase_category" character varying(2) NOT NULL DEFAULT '06'`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" ADD "isr_retention_type" character varying(2)`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" ADD "payment_form" character varying(2) NOT NULL DEFAULT '01'`);

    await queryRunner.query(`
      UPDATE "vendor_bills"
         SET "purchase_category" = COALESCE("fiscal_attributes" ->> 'purchaseCategory', '06'),
             "isr_retention_type" = "fiscal_attributes" ->> 'isrRetentionType',
             "payment_form" = COALESCE(left("payment_method_code", 2), '01')`);

    // Writing those rows queues the referential-integrity checks of the foreign keys that point at
    // `vendor_bills`, and PostgreSQL refuses to alter a table with trigger events still pending.
    await queryRunner.query(`SET CONSTRAINTS ALL IMMEDIATE`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" DROP COLUMN "payment_method_code"`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" DROP COLUMN "fiscal_attributes"`);

    await queryRunner.query(`DROP TRIGGER "TR_vendor_bills_fiscal_keys" ON "vendor_bills"`);
    await queryRunner.query(`DROP INDEX "UQ_vendor_bills_issuer_fiscal_number"`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" RENAME COLUMN "supplier_fiscal_number" TO "ncf"`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" RENAME COLUMN "supplier_fiscal_key" TO "ncf_key"`);
    await queryRunner.query(`ALTER TABLE "vendor_bills" RENAME COLUMN "modified_supplier_fiscal_number" TO "ncf_modified"`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION virtex_vendor_bills_fiscal_keys() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        NEW."ncf_key" := NULLIF(upper(regexp_replace(coalesce(NEW."ncf", ''), '[^0-9A-Za-z]', '', 'g')), '');
        IF TG_OP = 'INSERT' OR NEW."vendor_id" IS DISTINCT FROM OLD."vendor_id" THEN
          NEW."issuer_tax_key" := (SELECT s."tax_id_key" FROM "suppliers" s WHERE s."id" = NEW."vendor_id");
        END IF;
        RETURN NEW;
      END $fn$`);
    await queryRunner.query(`
      CREATE TRIGGER "TR_vendor_bills_fiscal_keys" BEFORE INSERT OR UPDATE OF "ncf", "vendor_id"
        ON "vendor_bills" FOR EACH ROW EXECUTE FUNCTION virtex_vendor_bills_fiscal_keys()`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_vendor_bills_issuer_ncf" ON "vendor_bills" ("organization_id", "issuer_tax_key", "ncf_key")
        WHERE "issuer_tax_key" IS NOT NULL AND "ncf_key" IS NOT NULL AND "status" NOT IN ('VOID', 'REJECTED')`);
  }
}
