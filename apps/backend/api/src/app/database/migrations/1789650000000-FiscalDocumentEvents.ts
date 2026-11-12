import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a taxpayer tells its authority ABOUT documents, in every market
 * (docs/ARQUITECTURA_MERCADOS.md, fase 3).
 *
 * `ecf_lifecycle_messages` held two declarations that are not documents themselves — the buyer's
 * verdict on a comprobante a supplier issued them, and the annulment of authorised numbers that
 * will never be used — with the DGII's vocabulary in its columns and the DGII's own codes as the
 * values of `verdict` (`1` approved, `2` rejected). Both facts exist in every regime: Brazil's
 * manifestação do destinatário and inutilização de numeração, Colombia's acuse de recibo y
 * aceptación, Peru's comunicación de baja, Mexico's aceptación de cancelación.
 *
 * | `ecf_lifecycle_messages` | `fiscal_document_events` |
 * |---|---|
 * | `kind` = COMMERCIAL_APPROVAL / SEQUENCE_VOID | `kind` = COUNTERPARTY_VERDICT / NUMBER_RANGE_VOID |
 * | `issuer_rnc` | `counterparty_tax_id` |
 * | `ncf` | `document_number` |
 * | `ecf_type` | `document_type` |
 * | `verdict` = `1` / `2` | `verdict` = ACCEPTED / REJECTED, and the market writes the authority's code |
 * | `signed_xml` | `payload` |
 * | `track_id` | `tracking_id` |
 * | `dgii_response` | `response` |
 * | — | `country_code`, `regime`: whose authority the event is for, as a submission records it |
 *
 * Every row that exists is a Dominican e-CF event, because the DGII's was the only regime that
 * wrote any; both directions are exact for them.
 */
export class FiscalDocumentEvents1789650000000 implements MigrationInterface {
  name = 'FiscalDocumentEvents1789650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ecf_lifecycle_messages" RENAME TO "fiscal_document_events"`);

    // ── Whose authority the event is for ───────────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" ADD "country_code" character varying(2)`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" ADD "regime" character varying(32)`);
    await queryRunner.query(`UPDATE "fiscal_document_events" SET "country_code" = 'DO', "regime" = 'DGII e-CF'`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" ALTER COLUMN "country_code" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" ALTER COLUMN "regime" SET NOT NULL`);

    // ── The columns say what they hold, not what one authority calls it ────────────────────
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "issuer_rnc" TO "counterparty_tax_id"`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" ALTER COLUMN "counterparty_tax_id" TYPE character varying(32)`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "ncf" TO "document_number"`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" ALTER COLUMN "document_number" TYPE character varying(64)`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "ecf_type" TO "document_type"`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "signed_xml" TO "payload"`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "track_id" TO "tracking_id"`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" ALTER COLUMN "tracking_id" TYPE character varying(128)`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "dgii_response" TO "response"`);

    // ── The kinds, as facts rather than as one regime's message names ──────────────────────
    await queryRunner.query(`DROP INDEX "UQ_ecf_lifecycle_approval"`);
    await queryRunner.query(`DROP INDEX "IDX_ecf_lifecycle_org_kind"`);
    await queryRunner.query(
      `CREATE TYPE "fiscal_document_events_kind_enum" AS ENUM('COUNTERPARTY_VERDICT', 'NUMBER_RANGE_VOID')`,
    );
    await queryRunner.query(`
      ALTER TABLE "fiscal_document_events"
        ALTER COLUMN "kind" TYPE "fiscal_document_events_kind_enum"
        USING (CASE "kind"::text
                 WHEN 'COMMERCIAL_APPROVAL' THEN 'COUNTERPARTY_VERDICT'
                 ELSE 'NUMBER_RANGE_VOID'
               END)::"fiscal_document_events_kind_enum"`);
    await queryRunner.query(`DROP TYPE "ecf_lifecycle_messages_kind_enum"`);

    // ── The verdict, in the product's own terms: the market writes the authority's code ────
    await queryRunner.query(
      `CREATE TYPE "fiscal_document_events_verdict_enum" AS ENUM('ACCEPTED', 'REJECTED')`,
    );
    await queryRunner.query(`
      ALTER TABLE "fiscal_document_events"
        ALTER COLUMN "verdict" TYPE "fiscal_document_events_verdict_enum"
        USING (CASE "verdict"::text WHEN '1' THEN 'ACCEPTED' WHEN '2' THEN 'REJECTED' ELSE NULL END)::"fiscal_document_events_verdict_enum"`);
    await queryRunner.query(`DROP TYPE "ecf_lifecycle_messages_verdict_enum"`);

    // ── The status type follows the table's name ───────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TYPE "ecf_lifecycle_messages_status_enum" RENAME TO "fiscal_document_events_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fiscal_document_events" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"fiscal_document_events_status_enum"`,
    );

    // The tenant key's constraint name is derived from the table's: renaming the table leaves a
    // constraint named after a table that no longer exists, which reads as drift on every build.
    await queryRunner.query(`
      ALTER TABLE "fiscal_document_events"
        RENAME CONSTRAINT "FK_7fed68c863674364f20ce290f34" TO "FK_b61c1e149c687de3a97d89b237f"`);
    await queryRunner.query(`ALTER INDEX "PK_ecf_lifecycle_messages" RENAME TO "PK_fiscal_document_events"`);

    await queryRunner.query(
      `CREATE INDEX "IDX_fiscal_document_events_org_kind" ON "fiscal_document_events" ("organization_id", "kind")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_fiscal_document_events_verdict"
        ON "fiscal_document_events" ("organization_id", "counterparty_tax_id", "document_number")
        WHERE "kind" = 'COUNTERPARTY_VERDICT'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_fiscal_document_events_verdict"`);
    await queryRunner.query(`DROP INDEX "IDX_fiscal_document_events_org_kind"`);

    await queryRunner.query(`ALTER TABLE "fiscal_document_events" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TYPE "fiscal_document_events_status_enum" RENAME TO "ecf_lifecycle_messages_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "fiscal_document_events" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"ecf_lifecycle_messages_status_enum"`,
    );

    await queryRunner.query(`CREATE TYPE "ecf_lifecycle_messages_verdict_enum" AS ENUM('1', '2')`);
    await queryRunner.query(`
      ALTER TABLE "fiscal_document_events"
        ALTER COLUMN "verdict" TYPE "ecf_lifecycle_messages_verdict_enum"
        USING (CASE "verdict"::text WHEN 'ACCEPTED' THEN '1' WHEN 'REJECTED' THEN '2' ELSE NULL END)::"ecf_lifecycle_messages_verdict_enum"`);
    await queryRunner.query(`DROP TYPE "fiscal_document_events_verdict_enum"`);

    await queryRunner.query(
      `CREATE TYPE "ecf_lifecycle_messages_kind_enum" AS ENUM('COMMERCIAL_APPROVAL', 'SEQUENCE_VOID')`,
    );
    await queryRunner.query(`
      ALTER TABLE "fiscal_document_events"
        ALTER COLUMN "kind" TYPE "ecf_lifecycle_messages_kind_enum"
        USING (CASE "kind"::text
                 WHEN 'COUNTERPARTY_VERDICT' THEN 'COMMERCIAL_APPROVAL'
                 ELSE 'SEQUENCE_VOID'
               END)::"ecf_lifecycle_messages_kind_enum"`);
    await queryRunner.query(`DROP TYPE "fiscal_document_events_kind_enum"`);

    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "response" TO "dgii_response"`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" ALTER COLUMN "tracking_id" TYPE character varying`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "tracking_id" TO "track_id"`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "payload" TO "signed_xml"`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "document_type" TO "ecf_type"`);
    await queryRunner.query(
      `ALTER TABLE "fiscal_document_events" ALTER COLUMN "document_number" TYPE character varying(19) USING left("document_number", 19)`,
    );
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "document_number" TO "ncf"`);
    await queryRunner.query(
      `ALTER TABLE "fiscal_document_events" ALTER COLUMN "counterparty_tax_id" TYPE character varying(16) USING left("counterparty_tax_id", 16)`,
    );
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME COLUMN "counterparty_tax_id" TO "issuer_rnc"`);

    await queryRunner.query(`ALTER TABLE "fiscal_document_events" DROP COLUMN "regime"`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" DROP COLUMN "country_code"`);

    await queryRunner.query(`ALTER INDEX "PK_fiscal_document_events" RENAME TO "PK_ecf_lifecycle_messages"`);
    await queryRunner.query(`
      ALTER TABLE "fiscal_document_events"
        RENAME CONSTRAINT "FK_b61c1e149c687de3a97d89b237f" TO "FK_7fed68c863674364f20ce290f34"`);
    await queryRunner.query(`ALTER TABLE "fiscal_document_events" RENAME TO "ecf_lifecycle_messages"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_ecf_lifecycle_org_kind" ON "ecf_lifecycle_messages" ("organization_id", "kind")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ecf_lifecycle_approval"
        ON "ecf_lifecycle_messages" ("organization_id", "issuer_rnc", "ncf")
        WHERE "kind" = 'COMMERCIAL_APPROVAL'`);
  }
}
