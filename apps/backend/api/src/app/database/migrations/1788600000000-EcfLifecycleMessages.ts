import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The two DGII messages that are part of the e-CF cycle but are not comprobantes, and the tenant
 * time zone their timestamps are written in.
 *
 * Neither the aprobación comercial (ACECF) nor the anulación de e-NCF (ANECF) had any storage:
 * `DgiiTransportService` could send both and their endpoints resolved in configuration, but nothing
 * built, signed, recorded or exposed them. A taxpayer using this product could not answer a
 * supplier's comprobante, nor explain a gap in its own numbering — both are obligations, not
 * conveniences.
 *
 * The `timezone` backfill is the other half of the same problem: every tenant carried the column's
 * `'UTC'` default because nothing ever set it, and every fiscal timestamp was produced from the
 * server clock. In Santo Domingo that is four hours ahead, so a sale made after 20:00 was signed
 * with the following day's date — a `FechaHoraFirma` later than the comprobante's own emission
 * date, which the DGII rejects, and a sale reported in the wrong month at every month end.
 */
export class EcfLifecycleMessages1788600000000 implements MigrationInterface {
  name = 'EcfLifecycleMessages1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."ecf_lifecycle_messages_kind_enum" AS ENUM ('COMMERCIAL_APPROVAL', 'SEQUENCE_VOID');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."ecf_lifecycle_messages_verdict_enum" AS ENUM ('1', '2');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // Dedicated enum types rather than reusing `ncf_sequences_type_enum` and
    // `ecf_submissions_status_enum`. TypeORM derives an enum type name from the table and column,
    // so sharing one across tables reads as drift on every build and the `check:schema-drift` gate
    // proposes rewriting the shared type — which would rewrite the other table's column with it.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."ecf_lifecycle_messages_ecf_type_enum" AS ENUM
          ('B01', 'B02', 'B03', 'B04', 'B11', 'B15', 'E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."ecf_lifecycle_messages_status_enum" AS ENUM
          ('PENDING', 'SIGNED', 'SENT', 'ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED', 'CONTINGENCY', 'ERROR');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ecf_lifecycle_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "kind" "public"."ecf_lifecycle_messages_kind_enum" NOT NULL,
        "issuer_rnc" character varying(16),
        "ncf" character varying(19),
        "document_date" date,
        "document_total" numeric(18,2),
        "verdict" "public"."ecf_lifecycle_messages_verdict_enum",
        "rejection_reason" text,
        "ecf_type" "public"."ecf_lifecycle_messages_ecf_type_enum",
        "sequence_from" bigint,
        "sequence_to" bigint,
        "signed_xml" text,
        "track_id" character varying,
        "status" "public"."ecf_lifecycle_messages_status_enum" NOT NULL DEFAULT 'PENDING',
        "dgii_response" jsonb,
        "messages" jsonb,
        "attempts" integer NOT NULL DEFAULT 0,
        "sent_at" TIMESTAMP WITH TIME ZONE,
        "responded_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_ecf_lifecycle_messages" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "ecf_lifecycle_messages"
        DROP CONSTRAINT IF EXISTS "FK_7fed68c863674364f20ce290f34"
    `);
    await queryRunner.query(`
      ALTER TABLE "ecf_lifecycle_messages"
        ADD CONSTRAINT "FK_7fed68c863674364f20ce290f34"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ecf_lifecycle_org_kind"
        ON "ecf_lifecycle_messages" ("organization_id", "kind")
    `);

    // One commercial answer per supplier comprobante: two verdicts on the same document leave the
    // DGII holding both with no way to tell which is current. Partial, because void rows carry no
    // NCF and several annulments of different ranges are perfectly legitimate.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ecf_lifecycle_approval"
        ON "ecf_lifecycle_messages" ("organization_id", "issuer_rnc", "ncf")
        WHERE "kind" = 'COMMERCIAL_APPROVAL'
    `);

    // Every tenant reads 'UTC' because nothing ever wrote this column. Give each the zone of its
    // own country; an operator elsewhere overrides it from settings.
    await queryRunner.query(`
      UPDATE "organizations" SET "timezone" = CASE upper("country")
        WHEN 'DO' THEN 'America/Santo_Domingo'
        WHEN 'US' THEN 'America/New_York'
        WHEN 'MX' THEN 'America/Mexico_City'
        WHEN 'CO' THEN 'America/Bogota'
        WHEN 'CL' THEN 'America/Santiago'
        WHEN 'PE' THEN 'America/Lima'
        WHEN 'AR' THEN 'America/Argentina/Buenos_Aires'
        WHEN 'BR' THEN 'America/Sao_Paulo'
        WHEN 'EC' THEN 'America/Guayaquil'
        WHEN 'UY' THEN 'America/Montevideo'
        WHEN 'PY' THEN 'America/Asuncion'
        WHEN 'BO' THEN 'America/La_Paz'
        WHEN 'VE' THEN 'America/Caracas'
        WHEN 'PA' THEN 'America/Panama'
        WHEN 'CR' THEN 'America/Costa_Rica'
        WHEN 'GT' THEN 'America/Guatemala'
        WHEN 'SV' THEN 'America/El_Salvador'
        WHEN 'HN' THEN 'America/Tegucigalpa'
        WHEN 'NI' THEN 'America/Managua'
        ELSE "timezone"
      END
      WHERE "timezone" = 'UTC' AND "country" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_ecf_lifecycle_approval"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ecf_lifecycle_org_kind"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ecf_lifecycle_messages"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ecf_lifecycle_messages_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ecf_lifecycle_messages_ecf_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ecf_lifecycle_messages_verdict_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ecf_lifecycle_messages_kind_enum"`);
    // The time zones are left in place: they are correct, and restoring 'UTC' would reintroduce the
    // defect this migration exists to remove.
  }
}
