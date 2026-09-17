import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `invoices.ncf_number` becomes `invoices.fiscal_number`.
 *
 * "NCF" is *Número de Comprobante Fiscal*, a DGII term, and it named the column that holds the
 * fiscal folio of every market's document: the folio of a Mexican CFDI, the número of a Chilean
 * DTE, the chave de acesso of a Brazilian NF-e. The column's own comment conceded it — "NCF /
 * e-NCF **in the Dominican Republic**" — which is the shape of a name that was correct once and
 * was never revisited when the meaning widened.
 *
 * A pure rename: no data is transformed, and the partial unique index is recreated over the new
 * name because its predicate referenced the old one.
 */
export class RenameNcfNumberToFiscalNumber1789005500000 implements MigrationInterface {
  name = 'RenameNcfNumberToFiscalNumber1789005500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Dropped first: its WHERE clause names the column, so it has to be rebuilt either way.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_invoices_org_ncf"`);

    await queryRunner.query(`ALTER TABLE "invoices" RENAME COLUMN "ncf_number" TO "fiscal_number"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" RENAME COLUMN "ncf_expires_at" TO "fiscal_number_expires_at"`,
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_invoices_org_fiscal_number"
        ON "invoices" ("organization_id", "fiscal_number")
        WHERE "fiscal_number" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_invoices_org_fiscal_number"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" RENAME COLUMN "fiscal_number_expires_at" TO "ncf_expires_at"`,
    );
    await queryRunner.query(`ALTER TABLE "invoices" RENAME COLUMN "fiscal_number" TO "ncf_number"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_invoices_org_ncf"
        ON "invoices" ("organization_id", "ncf_number")
        WHERE "ncf_number" IS NOT NULL
    `);
  }
}
