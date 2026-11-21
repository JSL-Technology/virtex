import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One table of authorised number ranges for every market (docs/ARQUITECTURA_MERCADOS.md, phase 2).
 *
 * The Dominican Republic kept its own, `ncf_sequences`, beside `fiscal_document_ranges`, which every
 * other market used: the same idea — a range the authority granted, a counter advanced under a row
 * lock — in two tables, read by two services with two sets of rules. The Dominican rows move into the
 * common table (country `DO`, no series: the type is the NCF's own prefix), and the Dominican table
 * goes.
 *
 * Every document drawn from a range also records what was drawn: the consecutive and the range's
 * series (`fiscal_sequence`, `fiscal_series`, on invoices and on till receipts). They used to be
 * parsed back out of the formatted number by a heuristic — the digits of its last hyphen-separated
 * segment — which is wrong the moment a series carries a digit (`FE2` and `1001` read as `21001`).
 * Matching a document to its range, and a new range to the numbers already issued, is now exact.
 *
 * Historical rows are backfilled from the shapes they were written in: a Dominican NCF is its type
 * followed by the consecutive; elsewhere the number is the range's series, optionally a hyphen, and
 * the consecutive (Peru, Ecuador, Colombia, Chile), or the bare consecutive with the series beside it
 * (Brazil's série). A number that matches no range, or more than one, is left without a recorded
 * consecutive rather than guessed — nothing is drawn for it again, and the builders refuse to write
 * it by name instead of writing a wrong one.
 *
 * Argentina's document types are AFIP's integer codes (`CbteTipo` 1, 6, 11), as its catalogue
 * declares them; they were recorded zero-padded (`01`), so they never matched it.
 */
export class UnifiedFiscalRanges1789610000000 implements MigrationInterface {
  name = 'UnifiedFiscalRanges1789610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['invoices', 'pos_sales']) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD "fiscal_sequence" bigint`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD "fiscal_series" character varying(16)`);
      await queryRunner.query(
        `CREATE INDEX "IDX_${table}_fiscal_sequence" ON "${table}" ("organization_id", "fiscal_document_type", "fiscal_series", "fiscal_sequence") WHERE "fiscal_sequence" IS NOT NULL`,
      );
    }

    // A Dominican range registered through the common endpoint was never drawn from — the Dominican
    // numbering read its own table — so where one is in force beside the Dominican table's range of
    // the same type, the Dominican table's is the one documents were numbered from and stays in force.
    await queryRunner.query(`
      UPDATE "fiscal_document_ranges" r SET "is_active" = false
       WHERE r."country_code" = 'DO' AND r."is_active" = true
         AND EXISTS (SELECT 1 FROM "ncf_sequences" s
                      WHERE s."organization_id" = r."organization_id" AND s."type" = r."document_type"
                        AND s."is_active" = true AND r."series" = '')`);

    // The Dominican ranges join every other market's, keeping their identity and their counters.
    await queryRunner.query(`
      INSERT INTO "fiscal_document_ranges"
        ("id", "organization_id", "country_code", "document_type", "series", "starts_at", "ends_at",
         "current_sequence", "is_active", "valid_until", "authorization_code")
      SELECT "id", "organization_id", 'DO', "type", '', "starts_at", "ends_at",
             "current_sequence", "is_active", "expires_at", "authorization_code"
        FROM "ncf_sequences"`);

    // A Dominican NCF is its type followed by the consecutive (`B01` + 8 digits, `E31` + 10), on an
    // invoice and on a till receipt alike.
    for (const table of ['invoices', 'pos_sales']) {
      await queryRunner.query(`
        UPDATE "${table}" d
           SET "fiscal_sequence" = substring(d."fiscal_number" from 4)::bigint, "fiscal_series" = ''
          FROM "organizations" o
         WHERE o."id" = d."organization_id" AND o."country" = 'DO'
           AND d."fiscal_number" ~ '^[BE][0-9]{2}[0-9]{1,15}$'`);
    }

    // Elsewhere: the range's series, an optional hyphen, the consecutive — within the range's bounds,
    // and only where exactly one range explains the number.
    await queryRunner.query(`
      WITH candidates AS (
        SELECT i."id" AS invoice_id, r."series", r."starts_at", r."ends_at",
               ltrim(substring(i."fiscal_number" from char_length(r."series") + 1), '-') AS tail
          FROM "invoices" i
          JOIN "organizations" o ON o."id" = i."organization_id"
          JOIN "fiscal_document_ranges" r
            ON r."organization_id" = i."organization_id" AND r."country_code" = o."country"
           AND r."document_type" = i."fiscal_document_type"
         WHERE i."fiscal_number" IS NOT NULL AND i."fiscal_sequence" IS NULL
           AND left(i."fiscal_number", char_length(r."series")) = r."series"
      ), parsed AS (
        SELECT invoice_id, "series", "starts_at", "ends_at",
               CASE WHEN tail ~ '^[0-9]{1,15}$' THEN tail::bigint END AS sequence
          FROM candidates
      ), matched AS (
        SELECT invoice_id, min("series") AS "series", min(sequence) AS sequence
          FROM parsed WHERE sequence BETWEEN "starts_at" AND "ends_at"
         GROUP BY invoice_id HAVING count(*) = 1
      )
      UPDATE "invoices" i SET "fiscal_sequence" = m.sequence, "fiscal_series" = m."series"
        FROM matched m WHERE i."id" = m.invoice_id`);

    // A bare consecutive whose series is not written into the number (the NF-e's série).
    await queryRunner.query(`
      WITH matched AS (
        SELECT i."id" AS invoice_id, min(r."series") AS "series", min(i."fiscal_number"::bigint) AS sequence
          FROM "invoices" i
          JOIN "organizations" o ON o."id" = i."organization_id"
          JOIN "fiscal_document_ranges" r
            ON r."organization_id" = i."organization_id" AND r."country_code" = o."country"
           AND r."document_type" = i."fiscal_document_type"
         WHERE i."fiscal_sequence" IS NULL
           AND (CASE WHEN i."fiscal_number" ~ '^[0-9]{1,15}$' THEN i."fiscal_number"::bigint END)
               BETWEEN r."starts_at" AND r."ends_at"
         GROUP BY i."id" HAVING count(*) = 1
      )
      UPDATE "invoices" i SET "fiscal_sequence" = m.sequence, "fiscal_series" = m."series"
        FROM matched m WHERE i."id" = m.invoice_id`);

    // AFIP's codes are integers; the catalogue declares them so.
    await queryRunner.query(`
      UPDATE "invoices" i
         SET "fiscal_document_type" = ltrim(i."fiscal_document_type", '0')
        FROM "organizations" o
       WHERE o."id" = i."organization_id" AND o."country" = 'AR'
         AND i."fiscal_document_type" ~ '^0[0-9]+$'`);

    await queryRunner.query(`DROP TABLE "ncf_sequences"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ncf_sequences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "type" character varying(8) NOT NULL,
        "prefix" character varying NOT NULL,
        "starts_at" bigint NOT NULL,
        "ends_at" bigint NOT NULL,
        "current_sequence" bigint NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "expires_at" date,
        "authorization_code" character varying(64),
        CONSTRAINT "PK_6ad6a3df04b2f7a9491e2097923" PRIMARY KEY ("id"),
        CONSTRAINT "FK_6cc063ba9a36272d0061b2413c2" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ncf_sequences_active_type" ON "ncf_sequences" ("organization_id", "type") WHERE "is_active" = true`,
    );
    await queryRunner.query(`ALTER TABLE "ncf_sequences" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "ncf_sequences" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON "ncf_sequences"
        USING ("organization_id" = (NULLIF(current_setting('app.current_organization', true), ''))::uuid)
        WITH CHECK ("organization_id" = (NULLIF(current_setting('app.current_organization', true), ''))::uuid)`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "ncf_sequences" TO virtex_app;
        END IF;
      END $$`);
    // The Dominican table has no series: one range per type was in force there, the series-less one.
    await queryRunner.query(`
      INSERT INTO "ncf_sequences"
        ("id", "organization_id", "type", "prefix", "starts_at", "ends_at", "current_sequence", "is_active", "expires_at", "authorization_code")
      SELECT "id", "organization_id", "document_type", "document_type", "starts_at", "ends_at", "current_sequence",
             "is_active" AND "series" = '', "valid_until", left("authorization_code", 64)
        FROM "fiscal_document_ranges" WHERE "country_code" = 'DO'`);
    await queryRunner.query(`DELETE FROM "fiscal_document_ranges" WHERE "country_code" = 'DO'`);

    for (const table of ['pos_sales', 'invoices']) {
      await queryRunner.query(`DROP INDEX "IDX_${table}_fiscal_sequence"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "fiscal_series"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "fiscal_sequence"`);
    }
  }
}
