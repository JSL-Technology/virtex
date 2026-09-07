import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A signing certificate belongs to a regime, not merely to a tenant.
 *
 * `ecf_certificates` held one active certificate per organization. A taxpayer operating in more
 * than one market holds more than one — a DGII certificate for the Dominican Republic, a CSD for
 * Mexico, a certificado de firma digital for Colombia — and they are not interchangeable: each is
 * issued by that country's authority, for that country's documents, and signing a CFDI with a
 * Dominican certificate produces a document the SAT rejects.
 *
 * Without the discriminator the second market would have silently signed with the first market's
 * key. Every existing row is a DGII certificate, which is what the default records.
 */
export class CertificatePerRegime1789001000000 implements MigrationInterface {
  name = 'CertificatePerRegime1789001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ecf_certificates"
        ADD COLUMN IF NOT EXISTS "regime" character varying(16) NOT NULL DEFAULT 'DGII'
    `);

    // The lookup is always "the active certificate of this regime for this tenant".
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ecf_certificates_org_regime_active"
        ON "ecf_certificates" ("organization_id", "regime", "is_active")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ecf_certificates_org_regime_active"`);
    await queryRunner.query(`ALTER TABLE "ecf_certificates" DROP COLUMN IF EXISTS "regime"`);
  }
}
