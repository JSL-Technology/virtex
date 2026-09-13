import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Blank values in optional unique columns become NULL, which is what they meant all along.
 *
 * A partial unique index — `UNIQUE (organization_id, sku) WHERE sku IS NOT NULL` — lets many rows
 * have no value while forbidding two from sharing one. Postgres exempts `NULL` and nothing else,
 * so two rows holding `''` are two rows holding the same value.
 *
 * An HTML form sends an untouched text input as the empty string. So the first product created
 * without a SKU stored `''`, and the second came back `409 A record with that data already
 * exists` — about a product whose name nobody else had used, naming no field. Measured in the
 * running application. The same shape applies to a customer's tax id, an organization's, and a
 * bank account number.
 *
 * `blankToNullTransformer` stops new rows from storing a blank; this clears the ones already
 * there, so the tenants that hit the defect can create their second untitled record.
 */
export class BlankUniqueToNull1789004600000 implements MigrationInterface {
  name = 'BlankUniqueToNull1789004600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "products" SET "sku" = NULL WHERE btrim("sku") = ''`);
    await queryRunner.query(`UPDATE "customers" SET "taxId" = NULL WHERE btrim("taxId") = ''`);
    await queryRunner.query(
      `UPDATE "bank_accounts" SET "account_number" = NULL WHERE btrim("account_number") = ''`,
    );
    await queryRunner.query(`UPDATE "organizations" SET "tax_id" = NULL WHERE btrim("tax_id") = ''`);
  }

  public async down(): Promise<void> {
    // Deliberately empty. Restoring `''` would restore the defect, and nothing distinguishes a row
    // that held a blank from one that held NULL to begin with.
  }
}
