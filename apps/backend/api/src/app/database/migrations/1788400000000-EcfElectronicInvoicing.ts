import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Electronic invoicing (e-CF) for the Dominican Republic.
 *
 *   - Extends the NCF type enum with the DGII electronic series (E31…E47) and adds an authorization
 *     expiry to `ncf_sequences` (e-NCF ranges are time-boxed, unlike legacy pre-printed ranges).
 *   - Adds `ecf_certificates`: the tenant's DGII signing certificate, stored AES-256-GCM encrypted.
 *   - Adds `ecf_submissions`: the lifecycle of every e-CF (built → signed → sent → DGII verdict),
 *     including trackId, security code, QR URL, the signed XML and the raw DGII responses.
 */
export class EcfElectronicInvoicing1788400000000 implements MigrationInterface {
  name = 'EcfElectronicInvoicing1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Electronic NCF types. ADD VALUE IF NOT EXISTS is safe and idempotent on PostgreSQL 12+.
    for (const value of ['E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47']) {
      await queryRunner.query(
        `ALTER TYPE "public"."ncf_sequences_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    // 2. e-NCF authorization expiry.
    await queryRunner.query(
      `ALTER TABLE "ncf_sequences" ADD COLUMN IF NOT EXISTS "expires_at" date`,
    );

    // 3. Certificates.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ecf_certificates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" character varying NOT NULL,
        "alias" character varying NOT NULL,
        "encrypted_pfx" text NOT NULL,
        "encrypted_password" text NOT NULL,
        "subject_common_name" character varying,
        "serial_number" character varying,
        "not_before" timestamptz,
        "not_after" timestamptz,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ecf_certificates" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ecf_certificates_org_active" ON "ecf_certificates" ("organization_id", "is_active")`,
    );

    // 4. Submissions.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."ecf_submissions_status_enum" AS ENUM (
          'PENDING', 'SIGNED', 'SENT', 'ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED', 'CONTINGENCY', 'ERROR'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ecf_submissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" character varying NOT NULL,
        "invoice_id" uuid NOT NULL,
        "ncf" character varying NOT NULL,
        "ecf_type" character varying(2) NOT NULL,
        "security_code" character varying,
        "track_id" character varying,
        "qr_url" text,
        "signed_xml" text,
        "status" "public"."ecf_submissions_status_enum" NOT NULL DEFAULT 'PENDING',
        "dgii_response" jsonb,
        "messages" jsonb,
        "attempts" integer NOT NULL DEFAULT 0,
        "sent_at" timestamptz,
        "responded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_ecf_submissions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ecf_submissions_invoice" ON "ecf_submissions" ("invoice_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ecf_submissions_org_status" ON "ecf_submissions" ("organization_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ecf_submissions_org_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_ecf_submissions_invoice"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ecf_submissions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."ecf_submissions_status_enum"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ecf_certificates_org_active"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ecf_certificates"`);
    await queryRunner.query(`ALTER TABLE "ncf_sequences" DROP COLUMN IF EXISTS "expires_at"`);
    // PostgreSQL cannot drop individual enum values; the added e-CF types are left in place.
  }
}
