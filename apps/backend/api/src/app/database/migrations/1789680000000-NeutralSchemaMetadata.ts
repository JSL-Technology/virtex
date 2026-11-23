import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The last two places where the schema itself named one market (docs/ARQUITECTURA_MERCADOS.md,
 * fase 9).
 *
 * 1. `signing_certificates.regime` defaulted to `'DGII'`. The column says which authority's
 *    documents a certificate signs, and a default makes one market's answer the answer for a row
 *    that forgot to give one: a Mexican CSD inserted without the field would have been filed as a
 *    Dominican e-CF certificate and found by the wrong adapter. The value is written from the
 *    company's market (`certificatePolicyFor`), so there is nothing to default to.
 *
 * 2. `invoices.tax` was commented «Consumption tax (ITBIS/IVA)». The column carries whichever
 *    consumption tax the market levies — IVA, ITBIS, IGV, ICMS, sales tax — and a comment is what
 *    a DBA reads when they open the table.
 *
 * Neither touches a value: existing rows keep their `regime` and the column keeps its data.
 */
export class NeutralSchemaMetadata1789680000000 implements MigrationInterface {
  name = 'NeutralSchemaMetadata1789680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "signing_certificates" ALTER COLUMN "regime" DROP DEFAULT`);
    await queryRunner.query(`COMMENT ON COLUMN "invoices"."tax" IS 'Consumption tax in transaction currency'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`COMMENT ON COLUMN "invoices"."tax" IS 'Consumption tax (ITBIS/IVA) in transaction currency'`);
    await queryRunner.query(`ALTER TABLE "signing_certificates" ALTER COLUMN "regime" SET DEFAULT 'DGII'`);
  }
}
