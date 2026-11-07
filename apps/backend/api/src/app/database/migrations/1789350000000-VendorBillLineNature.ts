import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Each supplier-bill line says whether it buys goods or services (audit 2026-10-31, AP-02).
 *
 * The bill defaulted its whole subtotal to services when the caller did not split it — which the
 * bill form never did — so every purchase of goods was reported in the 606 as services and was
 * withheld ISR it did not owe. The split is now derived from the lines and the nature resolved for
 * each is kept on it.
 *
 * Existing lines are left NULL: their bills' bases and withholdings were fixed when they were
 * recorded, and many are already declared. Inferring a nature now would describe them differently
 * from what was reported.
 */
export class VendorBillLineNature1789350000000 implements MigrationInterface {
  name = 'VendorBillLineNature1789350000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bill_line" ADD COLUMN IF NOT EXISTS "nature" character varying(8)`);
    await q.query(`
      ALTER TABLE "vendor_bill_line"
        ADD CONSTRAINT "CHK_vendor_bill_line_nature" CHECK ("nature" IS NULL OR "nature" IN ('GOODS', 'SERVICES'))
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bill_line" DROP CONSTRAINT IF EXISTS "CHK_vendor_bill_line_nature"`);
    await q.query(`ALTER TABLE "vendor_bill_line" DROP COLUMN IF EXISTS "nature"`);
  }
}
