import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Traditional and electronic comprobantes side by side, and certificates tied to their holder.
 *
 * - `organization_settings.fiscal_emission_mode`: `BOTH` (default), `ELECTRONIC` or `TRADITIONAL`.
 *   A Dominican company was required to hold a signing certificate to issue anything, even one that
 *   issues only traditional NCF (serie B), which are numbered and printed and never transmitted.
 *   Every existing company starts at `BOTH`, which changes nothing for one that issues e-CF and
 *   unblocks one that issues serie B.
 * - `ecf_certificates`: who the certificate was issued to (`holder_tax_id`, `holder_kind`), who
 *   issued it, and whether it is a self-signed test certificate. Upload now refuses a certificate of
 *   another company (QA V01); these columns keep what was verified so signing can check it again.
 *   Certificates loaded before this have no holder recorded and keep working as they did.
 */
export class DualFiscalEmission1789009900000 implements MigrationInterface {
  name = 'DualFiscalEmission1789009900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "fiscal_emission_mode" character varying(16) NOT NULL DEFAULT 'BOTH'
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "organization_settings"
          ADD CONSTRAINT "CK_organization_settings_fiscal_emission_mode"
          CHECK ("fiscal_emission_mode" IN ('BOTH', 'ELECTRONIC', 'TRADITIONAL'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "ecf_certificates"
        ADD COLUMN IF NOT EXISTS "holder_tax_id" character varying(20),
        ADD COLUMN IF NOT EXISTS "holder_kind" character varying(16),
        ADD COLUMN IF NOT EXISTS "issuer_common_name" character varying(255),
        ADD COLUMN IF NOT EXISTS "is_test" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "ecf_certificates"
          ADD CONSTRAINT "CK_ecf_certificates_holder_kind"
          CHECK ("holder_kind" IS NULL OR "holder_kind" IN ('company', 'person'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ecf_certificates" DROP CONSTRAINT IF EXISTS "CK_ecf_certificates_holder_kind"`);
    await queryRunner.query(`
      ALTER TABLE "ecf_certificates"
        DROP COLUMN IF EXISTS "is_test",
        DROP COLUMN IF EXISTS "issuer_common_name",
        DROP COLUMN IF EXISTS "holder_kind",
        DROP COLUMN IF EXISTS "holder_tax_id"
    `);
    await queryRunner.query(
      `ALTER TABLE "organization_settings" DROP CONSTRAINT IF EXISTS "CK_organization_settings_fiscal_emission_mode"`,
    );
    await queryRunner.query(`ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "fiscal_emission_mode"`);
  }
}
