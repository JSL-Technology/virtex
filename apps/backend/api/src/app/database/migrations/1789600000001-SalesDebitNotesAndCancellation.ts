import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sales debit notes and cancellation without a credit note, country-neutral (audit 2026-11-07,
 * FAC-INV-05).
 *
 *  - Every company gets its internal DEBIT_NOTE series, prefixed in the language its books are
 *    kept in (`ND-`, `DN-`), as new companies get it at provisioning.
 *  - `invoices.adjustment_reason`: why a debit note adds to an invoice, in the product's own
 *    taxonomy; each regime maps it to its authority's code.
 *  - `invoices.cancellation_mode`: how a VOID document came to be void. Existing invoices voided
 *    by a full credit note are marked CREDIT_NOTE, which is what lets the Dominican 607 keep them
 *    as the sales they were while the 608 declares only real annulments.
 *  - `fiscal_reason_codes`: authorities' reason catalogues as reference data with legal basis and
 *    validity, global like `statutory_tax_rates`; `invoices.cancellation_reason_code` is checked
 *    against it, for the tenant's country, by trigger. Seeded with the Dominican 608 catalogue.
 */
const TENANT_COUNTRY = `(SELECT UPPER(COALESCE(o."country", '')) FROM "organizations" o WHERE o."id" = NEW."organization_id")`;

/** DGII, formato 608 — Comprobantes fiscales anulados. Wording to confirm with a local accountant. */
const DO_608: ReadonlyArray<[string, string]> = [
  ['01', 'deteriorated_preprinted'],
  ['02', 'printing_errors_preprinted'],
  ['03', 'defective_printing'],
  ['04', 'information_correction'],
  ['05', 'product_change'],
  ['06', 'product_return'],
  ['07', 'product_omission'],
  ['08', 'ncf_sequence_errors'],
  ['09', 'business_closure'],
  ['10', 'books_lost_or_stolen'],
];

export class SalesDebitNotesAndCancellation1789600000001 implements MigrationInterface {
  name = 'SalesDebitNotesAndCancellation1789600000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "document_sequences" ("organization_id", "type", "prefix", "nextNumber", "isElectronic")
      SELECT o."id", 'DEBIT_NOTE'::"public"."document_sequences_type_enum",
             CASE WHEN LEFT(COALESCE(o."books_language", 'es'), 2) = 'en' THEN 'DN-' ELSE 'ND-' END, 1, false
        FROM "organizations" o
       WHERE NOT EXISTS (
         SELECT 1 FROM "document_sequences" d WHERE d."organization_id" = o."id" AND d."type"::text = 'DEBIT_NOTE'
       )`);

    await q.query(`
      ALTER TABLE "invoices"
        ADD COLUMN "adjustment_reason" character varying(32),
        ADD COLUMN "cancellation_mode" character varying(16),
        ADD COLUMN "cancellation_reason_code" character varying(16),
        ADD COLUMN "cancellation_journal_entry_id" uuid,
        ADD COLUMN "cancellation_cost_journal_entry_id" uuid,
        ADD CONSTRAINT "CHK_invoices_adjustment_reason"
          CHECK ("adjustment_reason" IS NULL OR "adjustment_reason" IN ('LATE_PAYMENT_INTEREST', 'ADDITIONAL_CHARGES', 'PRICE_INCREASE', 'PENALTY', 'OTHER')),
        ADD CONSTRAINT "CHK_invoices_cancellation_mode"
          CHECK ("cancellation_mode" IS NULL OR "cancellation_mode" IN ('VOID', 'REPORTED', 'CREDIT_NOTE'))`);
    // An invoice that is VOID because a credit note reversed it in full.
    await q.query(`
      UPDATE "invoices" i SET "cancellation_mode" = 'CREDIT_NOTE'
       WHERE i."status" = 'Void' AND i."type" = 'INVOICE'
         AND EXISTS (SELECT 1 FROM "invoices" n WHERE n."original_invoice_id" = i."id" AND n."type" = 'CREDIT_NOTE' AND n."status" <> 'Void')`);

    await q.query(`
      CREATE TABLE "fiscal_reason_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "country_code" character varying(2) NOT NULL,
        "purpose" character varying(32) NOT NULL,
        "code" character varying(16) NOT NULL,
        "label_key" character varying(160) NOT NULL,
        "legal_basis" text NOT NULL,
        "effective_from" date,
        "effective_to" date,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fiscal_reason_codes" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fiscal_reason_codes_period" CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from"),
        CONSTRAINT "CHK_fiscal_reason_codes_purpose" CHECK ("purpose" IN ('INVOICE_CANCELLATION'))
      )`);
    await q.query(`
      CREATE UNIQUE INDEX "UQ_fiscal_reason_codes_current" ON "fiscal_reason_codes" ("country_code", "purpose", "code")
        WHERE "effective_to" IS NULL`);
    // Reference data: read by every tenant, written only by migrations.
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT ON "fiscal_reason_codes" TO virtex_app;
        END IF;
      END
      $$`);
    for (const [code, slug] of DO_608) {
      await q.query(
        `INSERT INTO "fiscal_reason_codes" ("country_code", "purpose", "code", "label_key", "legal_basis")
         VALUES ('DO', 'INVOICE_CANCELLATION', $1, $2, $3)`,
        [code, `fiscal_reasons.do.invoice_cancellation.${slug}`, 'DGII, formato de envío 608 — Comprobantes fiscales anulados'],
      );
    }

    await q.query(`
      CREATE OR REPLACE FUNCTION virtex_check_cancellation_reason() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        on_date date := COALESCE(NEW."voided_at"::date, current_date);
      BEGIN
        IF NEW."cancellation_reason_code" IS NULL THEN
          RETURN NEW;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM "fiscal_reason_codes" r
           WHERE r."country_code" = ${TENANT_COUNTRY}
             AND r."purpose" = 'INVOICE_CANCELLATION'
             AND r."code" = NEW."cancellation_reason_code"
             AND (r."effective_from" IS NULL OR r."effective_from" <= on_date)
             AND (r."effective_to" IS NULL OR r."effective_to" >= on_date)
        ) THEN
          RAISE EXCEPTION 'cancellation reason % is not in the catalogue of the tenant''s country on %', NEW."cancellation_reason_code", on_date
            USING ERRCODE = 'check_violation', CONSTRAINT = 'CHK_invoices_cancellation_reason_code';
        END IF;
        RETURN NEW;
      END
      $$`);
    await q.query(`
      CREATE TRIGGER "TRG_invoices_cancellation_reason"
        BEFORE INSERT OR UPDATE OF "cancellation_reason_code" ON "invoices"
        FOR EACH ROW EXECUTE FUNCTION virtex_check_cancellation_reason()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER "TRG_invoices_cancellation_reason" ON "invoices"`);
    await q.query(`DROP FUNCTION virtex_check_cancellation_reason()`);
    await q.query(`DROP TABLE "fiscal_reason_codes"`);
    await q.query(`
      ALTER TABLE "invoices"
        DROP CONSTRAINT "CHK_invoices_adjustment_reason",
        DROP CONSTRAINT "CHK_invoices_cancellation_mode",
        DROP COLUMN "adjustment_reason",
        DROP COLUMN "cancellation_mode",
        DROP COLUMN "cancellation_reason_code",
        DROP COLUMN "cancellation_journal_entry_id",
        DROP COLUMN "cancellation_cost_journal_entry_id"`);
    await q.query(`DELETE FROM "document_sequences" WHERE "type"::text = 'DEBIT_NOTE'`);
  }
}
