import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Why a note modifies an issued document, in the product's own terms, for every market
 * (docs/ARQUITECTURA_MERCADOS.md, phase 2).
 *
 * `invoices.modification_code` was the DGII's `CodigoModificacion` — one authority's catalogue, as a
 * PostgreSQL enum of its five codes, on every invoice of every market. A Chilean or Peruvian credit
 * note carried a Dominican number, and the HTTP boundary accepted one from any tenant: the core
 * stored a fact only one market can read.
 *
 * The commercial fact is the same everywhere — the document is annulled, goods came back, the price
 * went down, the text was wrong — so that is what is stored, in `adjustment_reason`, which already
 * carried a debit note's reason. Each market writes its authority's code for it
 * (`MarketDocuments.adjustmentCodes`): the DGII's 1, 2 or 3 among them.
 *
 * The codes already recorded are read back into the reason they stood for. `3` (corrects amounts)
 * says only that the amounts changed, so it becomes `OTHER` and the words the issuer wrote carry the
 * rest; `4` and `5` answer no reason an issuer states and were never issued by this product.
 */
export class CanonicalAdjustmentReasons1789620000000 implements MigrationInterface {
  name = 'CanonicalAdjustmentReasons1789620000000';

  /** The canonical reasons, as `ADJUSTMENT_REASONS` lists them. */
  private static readonly REASONS = [
    'ANNULMENT',
    'GOODS_RETURN',
    'PRICE_REDUCTION',
    'DETAIL_CORRECTION',
    'OTHER',
    'LATE_PAYMENT_INTEREST',
    'ADDITIONAL_CHARGES',
    'PRICE_INCREASE',
    'PENALTY',
  ];

  /** The reasons a debit note carried while the column was its alone. */
  private static readonly DEBIT_REASONS = ['LATE_PAYMENT_INTEREST', 'ADDITIONAL_CHARGES', 'PRICE_INCREASE', 'PENALTY', 'OTHER'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const reasons = CanonicalAdjustmentReasons1789620000000.REASONS.map((reason) => `'${reason}'`).join(', ');
    await queryRunner.query(`ALTER TABLE "invoices" DROP CONSTRAINT "CHK_invoices_adjustment_reason"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "CHK_invoices_adjustment_reason" CHECK ("adjustment_reason" IS NULL OR "adjustment_reason" IN (${reasons}))`,
    );

    await queryRunner.query(`
      UPDATE "invoices"
         SET "adjustment_reason" = CASE "modification_code"::text
               WHEN '1' THEN 'ANNULMENT'
               WHEN '2' THEN 'DETAIL_CORRECTION'
               ELSE 'OTHER'
             END
       WHERE "modification_code" IS NOT NULL AND "adjustment_reason" IS NULL`);

    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "modification_code"`);
    await queryRunner.query(`DROP TYPE "invoices_modification_code_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "invoices_modification_code_enum" AS ENUM('1', '2', '3', '4', '5')`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "modification_code" "invoices_modification_code_enum"`,
    );

    // The Dominican code the previous version derived, for the notes it derived it for.
    await queryRunner.query(`
      UPDATE "invoices"
         SET "modification_code" = (CASE "adjustment_reason"
               WHEN 'ANNULMENT' THEN '1'
               WHEN 'DETAIL_CORRECTION' THEN '2'
               ELSE '3'
             END)::"invoices_modification_code_enum"
       WHERE "type" = 'CREDIT_NOTE' AND "adjustment_reason" IS NOT NULL`);

    // The column was a debit note's alone, and the narrower check refuses anything else.
    await queryRunner.query(`UPDATE "invoices" SET "adjustment_reason" = NULL WHERE "type" <> 'DEBIT_NOTE'`);

    // Writing those rows queues the referential-integrity checks of the foreign keys that point at
    // `invoices`, and PostgreSQL refuses to alter a table with trigger events still pending. Firing
    // them now is what lets the constraint be swapped back inside this same transaction.
    await queryRunner.query(`SET CONSTRAINTS ALL IMMEDIATE`);
    const debit = CanonicalAdjustmentReasons1789620000000.DEBIT_REASONS.map((reason) => `'${reason}'`).join(', ');
    await queryRunner.query(`ALTER TABLE "invoices" DROP CONSTRAINT "CHK_invoices_adjustment_reason"`);
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "CHK_invoices_adjustment_reason" CHECK ("adjustment_reason" IS NULL OR "adjustment_reason" IN (${debit}))`,
    );
  }
}
