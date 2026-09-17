import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Populate the fiscal document-type catalogue and retire the two DGII enums built on top of it.
 *
 * ## What was wrong
 *
 * `ncf_sequences.type` and `ecf_lifecycle_messages.ecf_type` were PostgreSQL enums of `NcfType` —
 * `B01`…`E47`, the DGII's comprobante codes — on tables in `compliance` and `einvoicing`, modules
 * not scoped to the Dominican Republic by anything but habit. Peru's `01`/`03`/`07`/`08`, Chile's
 * DTE `33`/`34`/`61` and Mexico's `I`/`E`/`P` had no representation, and adding one meant
 * `ALTER TYPE … ADD VALUE`: a migration, a deploy, and a value the type can never lose again.
 *
 * `invoices/interfaces/fiscal-adapter.interface.ts` had already made this exact decision for the
 * adapter contract — its comment records that the document type stopped being an `NcfType` and
 * became a plain string owned by the market's adapter — and stopped short of the persistence.
 *
 * Meanwhile `fiscal_document_type_definitions`, a table shaped for precisely this, had been in
 * the baseline schema since the beginning with zero reads, zero writes and zero seeds.
 *
 * ## The columns added to it
 *
 * `name` alone cannot drive a form. Which types are issuable as a sale, which credit an earlier
 * document, which are transmitted electronically and which need the buyer's tax id were encoded
 * as `SALES_NCF_TYPES`, `CREDIT_NOTE_NCF_TYPES`, `isElectronicNcfType()` and a
 * `code === NcfType.E31` comparison in the adapter. They are properties of the document type, so
 * they move onto it.
 *
 * ## Why `varchar` and no foreign key
 *
 * The rows are written by `LocalizationService.seedFiscalDocumentTypes()` at boot, which runs
 * after migrations — so a foreign key added here would be validated against an empty table, and
 * seeding the rows in SQL as well would duplicate a declaration that already exists in TypeScript
 * and would then drift from it. `ComplianceService` validates a requested code against the
 * catalogue before provisioning a range, which is the check that matters, at the point where a
 * useful error can be raised.
 */
export class FiscalDocumentTypeCatalogue1789005400000 implements MigrationInterface {
  name = 'FiscalDocumentTypeCatalogue1789005400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. The catalogue gains the columns that make it usable ──────────────
    await queryRunner.query(`
      ALTER TABLE "fiscal_document_type_definitions"
        ADD COLUMN IF NOT EXISTS "label_key" character varying(128),
        ADD COLUMN IF NOT EXISTS "is_electronic" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "side" character varying(16) NOT NULL DEFAULT 'sales',
        ADD COLUMN IF NOT EXISTS "is_credit_note" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "requires_buyer_tax_id" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "sort_order" smallint NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "fiscal_document_type_definitions"
        ADD CONSTRAINT "CK_fiscal_document_type_definitions_side"
        CHECK ("side" IN ('sales', 'purchase', 'either'))
    `);

    // The natural key the seeder upserts on. The table had none, so nothing stopped two rows
    // claiming the same code for the same region.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_fiscal_document_type_definitions"
        ON "fiscal_document_type_definitions" ("fiscalRegionId", "code")
    `);

    // ── 2. The two enum columns become plain codes ──────────────────────────
    //
    // `USING type::text` preserves every stored value exactly: the enum's labels ARE the codes.
    await queryRunner.query(`
      ALTER TABLE "ncf_sequences"
        ALTER COLUMN "type" TYPE character varying(8) USING "type"::text
    `);
    await queryRunner.query(`
      ALTER TABLE "ecf_lifecycle_messages"
        ALTER COLUMN "ecf_type" TYPE character varying(8) USING "ecf_type"::text
    `);

    // ── 3. Drop the enum types now that nothing references them ─────────────
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ncf_sequences_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ecf_lifecycle_messages_ecf_type_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."ncf_sequences_type_enum" AS ENUM (
        'B01','B02','B03','B04','B11','B15',
        'E31','E32','E33','E34','E41','E43','E44','E45','E46','E47'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."ecf_lifecycle_messages_ecf_type_enum" AS ENUM (
        'B01','B02','B03','B04','B11','B15',
        'E31','E32','E33','E34','E41','E43','E44','E45','E46','E47'
      )
    `);
    // A row carrying a code the enum cannot express — a Peruvian `01`, say — has no representation
    // in the old schema and would fail the cast. That is the data loss this migration removes
    // going forward, and reversing it is the one case where it can still happen.
    await queryRunner.query(`
      ALTER TABLE "ncf_sequences"
        ALTER COLUMN "type" TYPE "public"."ncf_sequences_type_enum"
        USING "type"::"public"."ncf_sequences_type_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "ecf_lifecycle_messages"
        ALTER COLUMN "ecf_type" TYPE "public"."ecf_lifecycle_messages_ecf_type_enum"
        USING "ecf_type"::"public"."ecf_lifecycle_messages_ecf_type_enum"
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_fiscal_document_type_definitions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fiscal_document_type_definitions" DROP CONSTRAINT IF EXISTS "CK_fiscal_document_type_definitions_side"`,
    );
    await queryRunner.query(`
      ALTER TABLE "fiscal_document_type_definitions"
        DROP COLUMN IF EXISTS "sort_order",
        DROP COLUMN IF EXISTS "requires_buyer_tax_id",
        DROP COLUMN IF EXISTS "is_credit_note",
        DROP COLUMN IF EXISTS "side",
        DROP COLUMN IF EXISTS "is_electronic",
        DROP COLUMN IF EXISTS "label_key"
    `);
  }
}
