import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One outbox for every market's electronic documents (docs/ARQUITECTURA_MERCADOS.md, fase 3).
 *
 * The Dominican e-CF had a table of its own, `ecf_submissions`, with the DGII's vocabulary in its
 * column names — `ncf`, `ecf_type`, `security_code`, `qr_url`, `signed_xml`, `track_id`,
 * `dgii_response` — while six other regimes shared `fiscal_submissions`. Two tables, two
 * pipelines, two reconcilers and two answers to «where does this document stand with its
 * authority», depending on the country.
 *
 * Every e-CF row moves, column for column:
 *
 * | `ecf_submissions` | `fiscal_submissions` |
 * |---|---|
 * | `ncf` | `fiscal_number` |
 * | `ecf_type` | `document_type` |
 * | `security_code` | `document_key` — the identifier the authority recomputes |
 * | `qr_url` | `verification_url` — where its portal resolves the document |
 * | `signed_xml` | `payload` — the sealed document as sent |
 * | `track_id` | `tracking_id` |
 * | `dgii_response` | `response` |
 *
 * Two of the DGII's states were not in the shared vocabulary and are added to it, because they are
 * not Dominican facts: an authority's third verdict (`ACCEPTED_WITH_OBSERVATIONS`, «Aceptado
 * Condicional» here, an accepted CDR with observations at SUNAT) and a document issued while the
 * authority could not be reached (`CONTINGENCY`, which Brazil and Ecuador also provide for).
 * `SIGNED` is not among them: the shared pipeline builds, seals and transmits in one claimed run,
 * so a document that was signed and not sent is simply not sent yet — `PENDING`.
 *
 * `ecf_lifecycle_messages.status` takes the same shared type, so the one vocabulary covers both a
 * document and a message about documents.
 */
export class DgiiSubmissionsIntoOneOutbox1789640000000 implements MigrationInterface {
  name = 'DgiiSubmissionsIntoOneOutbox1789640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── The shared vocabulary learns the two states it lacked ───────────────────────────────
    //
    // The type is rebuilt rather than extended with `ALTER TYPE … ADD VALUE`: PostgreSQL refuses to
    // USE a value added in the still-open transaction that added it («unsafe use of new value»),
    // and the rows below are inserted with those very values. Rebuilding keeps the whole move in
    // one transaction, which is what makes it all-or-nothing.
    await queryRunner.query(`ALTER TABLE "fiscal_submissions" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TYPE "fiscal_submissions_status_enum" RENAME TO "fiscal_submissions_status_enum_old"`);
    await queryRunner.query(`
      CREATE TYPE "fiscal_submissions_status_enum" AS ENUM(
        'PENDING', 'NOT_CONFIGURED', 'SENT', 'CONTINGENCY', 'ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED', 'ERROR'
      )`);
    await queryRunner.query(`
      ALTER TABLE "fiscal_submissions"
        ALTER COLUMN "status" TYPE "fiscal_submissions_status_enum" USING "status"::text::"fiscal_submissions_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "fiscal_submissions" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"fiscal_submissions_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "fiscal_submissions_status_enum_old"`);

    // ── What a regime records beyond the number: its type, and where it is verified ─────────
    await queryRunner.query(`ALTER TABLE "fiscal_submissions" ADD "document_type" character varying(8)`);
    await queryRunner.query(`ALTER TABLE "fiscal_submissions" ADD "verification_url" text`);

    // ── Every e-CF row, as a submission of the DGII regime ──────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "fiscal_submissions" (
        "organization_id", "invoice_id", "country_code", "regime", "fiscal_number", "document_type",
        "status", "document_key", "tracking_id", "verification_url", "payload", "messages",
        "response", "attempts", "sent_at", "responded_at", "created_at", "updated_at"
      )
      SELECT s."organization_id", s."invoice_id", 'DO', 'DGII e-CF', s."ncf",
             -- The type as the market's catalogue names it, from the number the DGII assigned:
             -- E310000000001 is an E31, which is what the ranges table holds.
             left(s."ncf", 3),
             (CASE s."status"::text WHEN 'SIGNED' THEN 'PENDING' ELSE s."status"::text END)::"fiscal_submissions_status_enum",
             s."security_code", s."track_id", s."qr_url", s."signed_xml", COALESCE(s."messages", '[]'::jsonb),
             s."dgii_response", s."attempts", s."sent_at", s."responded_at", s."created_at", s."updated_at"
        FROM "ecf_submissions" s
       ON CONFLICT ("invoice_id") DO NOTHING`);

    await queryRunner.query(`DROP TABLE "ecf_submissions"`);
    await queryRunner.query(`DROP TYPE "ecf_submissions_status_enum"`);

    // ── A message about documents is in the same lifecycle as a document ────────────────────
    //
    // The same states, under this table's own type: one shared PostgreSQL type between two entities
    // is drift on every build, because TypeORM models one enum type per column.
    await queryRunner.query(`ALTER TABLE "ecf_lifecycle_messages" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TYPE "ecf_lifecycle_messages_status_enum" RENAME TO "ecf_lifecycle_messages_status_enum_old"`);
    await queryRunner.query(`
      CREATE TYPE "ecf_lifecycle_messages_status_enum" AS ENUM(
        'PENDING', 'NOT_CONFIGURED', 'SENT', 'CONTINGENCY', 'ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED', 'ERROR'
      )`);
    await queryRunner.query(`
      ALTER TABLE "ecf_lifecycle_messages"
        ALTER COLUMN "status" TYPE "ecf_lifecycle_messages_status_enum"
        USING (CASE "status"::text WHEN 'SIGNED' THEN 'PENDING' ELSE "status"::text END)::"ecf_lifecycle_messages_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "ecf_lifecycle_messages" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"ecf_lifecycle_messages_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "ecf_lifecycle_messages_status_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ecf_lifecycle_messages" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TYPE "ecf_lifecycle_messages_status_enum" RENAME TO "ecf_lifecycle_messages_status_enum_new"`);
    await queryRunner.query(
      `CREATE TYPE "ecf_lifecycle_messages_status_enum" AS ENUM('PENDING', 'SIGNED', 'SENT', 'ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED', 'CONTINGENCY', 'ERROR')`,
    );
    await queryRunner.query(`
      ALTER TABLE "ecf_lifecycle_messages"
        ALTER COLUMN "status" TYPE "ecf_lifecycle_messages_status_enum"
        USING (CASE "status"::text WHEN 'NOT_CONFIGURED' THEN 'PENDING' ELSE "status"::text END)::"ecf_lifecycle_messages_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "ecf_lifecycle_messages" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"ecf_lifecycle_messages_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "ecf_lifecycle_messages_status_enum_new"`);

    await queryRunner.query(
      `CREATE TYPE "ecf_submissions_status_enum" AS ENUM('PENDING', 'SIGNED', 'SENT', 'ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED', 'CONTINGENCY', 'ERROR')`,
    );
    await queryRunner.query(`
      CREATE TABLE "ecf_submissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "invoice_id" uuid NOT NULL,
        "ncf" character varying NOT NULL,
        "ecf_type" character varying(2) NOT NULL,
        "security_code" character varying,
        "track_id" character varying,
        "qr_url" text,
        "signed_xml" text,
        "status" "ecf_submissions_status_enum" NOT NULL DEFAULT 'PENDING',
        "dgii_response" jsonb,
        "messages" jsonb,
        "attempts" integer NOT NULL DEFAULT 0,
        "sent_at" timestamptz,
        "responded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_ecf_submissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ecf_submissions_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ecf_submissions_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") DEFERRABLE INITIALLY DEFERRED
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_ecf_submissions_invoice" ON "ecf_submissions" ("invoice_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_ecf_submissions_org_status" ON "ecf_submissions" ("organization_id", "status")`);

    // The tenant policy and the same-tenant guard, as every tenant-scoped table carries them.
    await queryRunner.query(`ALTER TABLE "ecf_submissions" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE "ecf_submissions" FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON "ecf_submissions"
        USING ("organization_id" = NULLIF(current_setting('app.current_organization', true), '')::uuid)
        WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization', true), '')::uuid)`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "ecf_submissions" TO virtex_app;
        END IF;
      END
      $$;`);
    await queryRunner.query(`SELECT virtex_install_same_tenant_guards()`);

    // The Dominican rows go back, with the DGII's names for their columns.
    await queryRunner.query(`
      INSERT INTO "ecf_submissions" (
        "organization_id", "invoice_id", "ncf", "ecf_type", "security_code", "track_id", "qr_url",
        "signed_xml", "status", "dgii_response", "messages", "attempts", "sent_at", "responded_at",
        "created_at", "updated_at"
      )
      SELECT f."organization_id", f."invoice_id", COALESCE(f."fiscal_number", ''),
             -- ecf_type is the DGII's two digits; the outbox records the type as the market's own
             -- catalogue names it (E31), which is what fiscal_document_ranges holds too.
             right(COALESCE(NULLIF(f."document_type", ''), COALESCE(f."fiscal_number", '')), 2),
             f."document_key", f."tracking_id", f."verification_url", f."payload",
             (CASE f."status"::text WHEN 'NOT_CONFIGURED' THEN 'PENDING' ELSE f."status"::text END)::"ecf_submissions_status_enum",
             f."response", f."messages", f."attempts", f."sent_at", f."responded_at", f."created_at", f."updated_at"
        FROM "fiscal_submissions" f
       WHERE f."country_code" = 'DO'`);
    await queryRunner.query(`DELETE FROM "fiscal_submissions" WHERE "country_code" = 'DO'`);

    await queryRunner.query(`ALTER TABLE "fiscal_submissions" DROP COLUMN "verification_url"`);
    await queryRunner.query(`ALTER TABLE "fiscal_submissions" DROP COLUMN "document_type"`);

    // A value cannot be removed from a PostgreSQL enum, so the type is rebuilt without the two the
    // shared vocabulary did not have, and the rows that used them take the nearest state it has.
    await queryRunner.query(`ALTER TABLE "fiscal_submissions" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(`ALTER TYPE "fiscal_submissions_status_enum" RENAME TO "fiscal_submissions_status_enum_old"`);
    await queryRunner.query(
      `CREATE TYPE "fiscal_submissions_status_enum" AS ENUM('PENDING', 'NOT_CONFIGURED', 'SENT', 'ACCEPTED', 'REJECTED', 'ERROR')`,
    );
    await queryRunner.query(`
      ALTER TABLE "fiscal_submissions"
        ALTER COLUMN "status" TYPE "fiscal_submissions_status_enum"
        USING (CASE "status"::text
                 WHEN 'CONTINGENCY' THEN 'ERROR'
                 WHEN 'ACCEPTED_WITH_OBSERVATIONS' THEN 'ACCEPTED'
                 ELSE "status"::text
               END)::"fiscal_submissions_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "fiscal_submissions" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"fiscal_submissions_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE "fiscal_submissions_status_enum_old"`);
  }
}
