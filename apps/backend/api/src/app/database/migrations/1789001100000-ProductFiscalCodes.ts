import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The catalogue values a document line must carry in its market.
 *
 * Every regime this product is extending to classifies the thing sold against a catalogue the
 * authority publishes: `ClaveProdServ` and `ClaveUnidad` in Mexico, the UNSPSC code in Colombia,
 * `codigoTipoItem` in Peru, `NCM` and `CFOP` in Brazil. None of them can be inferred from a
 * product's name, and a value invented by the software produces a document that is accepted by
 * the authority and misdescribes what was sold — which is worse than one that refuses to be built.
 *
 * A map on the product rather than a column per market: a tenant sells in one country, and seven
 * columns would be six empty ones on every product row. Snapshotted onto the invoice line at
 * issuance, like the tax rate beside it and for the same reason — a document is a record of what
 * was declared, and re-reading today's product to rebuild a document filed two years ago would
 * reconstruct a different declaration.
 *
 * `products.fiscal_item_code` already held the Mexican `ClaveProdServ` under an older name; it
 * stays, and the resolver folds it into the map so a product configured before this keeps working.
 */
export class ProductFiscalCodes1789001100000 implements MigrationInterface {
  name = 'ProductFiscalCodes1789001100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "fiscal_codes" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "fiscal_codes" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoice_line_item" DROP COLUMN IF EXISTS "fiscal_codes"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "fiscal_codes"`);
  }
}
