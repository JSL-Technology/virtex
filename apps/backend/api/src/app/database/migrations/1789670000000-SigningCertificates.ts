import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The certificates that sign a market's electronic documents, in a table that says so
 * (docs/ARQUITECTURA_MERCADOS.md, fase 9).
 *
 * `ecf_certificates` held every regime's signing material — a Mexican CSD, a Chilean certificate
 * for the SII, a Colombian one for the DIAN — under the name of the Dominican comprobante. The
 * table is the same, with the same rows and the same encrypted material; only the names change, so
 * that nothing in the schema says one authority's word where it means every one of them.
 *
 * Index, primary key, check constraint and the tenant policy are renamed with it: a constraint
 * named after a table that no longer exists reads as drift on every build.
 */
export class SigningCertificates1789670000000 implements MigrationInterface {
  name = 'SigningCertificates1789670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ecf_certificates" RENAME TO "signing_certificates"`);
    await queryRunner.query(`ALTER INDEX "PK_ecf_certificates" RENAME TO "PK_signing_certificates"`);
    await queryRunner.query(
      `ALTER INDEX "IDX_ecf_certificates_org_active" RENAME TO "IDX_signing_certificates_org_active"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_ecf_certificates_org_regime_active" RENAME TO "IDX_signing_certificates_org_regime_active"`,
    );
    await queryRunner.query(`
      ALTER TABLE "signing_certificates"
        RENAME CONSTRAINT "CK_ecf_certificates_holder_kind" TO "CK_signing_certificates_holder_kind"`);
    // The tenant key's constraint name is derived from the table's: renaming the table leaves a
    // constraint named after a table that no longer exists, which reads as drift on every build.
    await queryRunner.query(`
      ALTER TABLE "signing_certificates"
        RENAME CONSTRAINT "FK_69e9d6b000e0dc1dc9e232add15" TO "FK_c507b53203c828c5c5065048973"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "signing_certificates"
        RENAME CONSTRAINT "FK_c507b53203c828c5c5065048973" TO "FK_69e9d6b000e0dc1dc9e232add15"`);
    await queryRunner.query(`
      ALTER TABLE "signing_certificates"
        RENAME CONSTRAINT "CK_signing_certificates_holder_kind" TO "CK_ecf_certificates_holder_kind"`);
    await queryRunner.query(
      `ALTER INDEX "IDX_signing_certificates_org_regime_active" RENAME TO "IDX_ecf_certificates_org_regime_active"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_signing_certificates_org_active" RENAME TO "IDX_ecf_certificates_org_active"`,
    );
    await queryRunner.query(`ALTER INDEX "PK_signing_certificates" RENAME TO "PK_ecf_certificates"`);
    await queryRunner.query(`ALTER TABLE "signing_certificates" RENAME TO "ecf_certificates"`);
  }
}
