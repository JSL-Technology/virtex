import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An account carries the authority's own grouping code, where the market publishes one.
 *
 * Mexico is the case this exists for. Every taxpayer files a Catálogo de cuentas that maps each of
 * their accounts onto a code from the SAT's published list — `100.01` Caja, `102.01` Bancos
 * nacionales — and without that mapping the catalogue cannot be built at all: the taxpayer's own
 * numbering says nothing to the authority.
 *
 * Deliberately its own column rather than a key inside `statement_mapping`. That JSON describes
 * where an account appears in a financial statement, which is a presentation decision; this is a
 * fiscal identifier assigned from a published list. Conflating them is how a change to how the
 * balance sheet groups things would silently alter a filing.
 *
 * Null for every existing account: the mapping is a decision the taxpayer's accountant makes
 * against the SAT's list, and a guessed code is a wrong filing rather than a missing one.
 */
export class FiscalGroupingCode1789000900000 implements MigrationInterface {
  name = 'FiscalGroupingCode1789000900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "accounts"
        ADD COLUMN IF NOT EXISTS "fiscal_grouping_code" character varying(20)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "fiscal_grouping_code"`);
  }
}
