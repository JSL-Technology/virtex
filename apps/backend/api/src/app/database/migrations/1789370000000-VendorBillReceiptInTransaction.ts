import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A supplier bill moves its stock in its own transaction (audit 2026-10-31, AP-05).
 *
 *  - `vendor_bills.receipt_warehouse_id`: where the bill's own goods entered, so a void takes them
 *    out of the same warehouse. Bills posted before this have none; their void falls back to the
 *    bill's branch, as the old after-commit handler did.
 *  - `vendor_bill_line.received_cost_absorbed`: the share of a price difference on received goods
 *    that went into the average cost of the stock on hand, and `received_cost_units` how many units
 *    carried it, so a void can give it back while those units are still there.
 */
export class VendorBillReceiptInTransaction1789370000000 implements MigrationInterface {
  name = 'VendorBillReceiptInTransaction1789370000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "receipt_warehouse_id" uuid`);
    await q.query(
      `ALTER TABLE "vendor_bill_line" ADD COLUMN IF NOT EXISTS "received_cost_absorbed" numeric(18,2) NOT NULL DEFAULT 0`,
    );
    await q.query(
      `ALTER TABLE "vendor_bill_line" ADD COLUMN IF NOT EXISTS "received_cost_units" numeric(18,6) NOT NULL DEFAULT 0`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bill_line" DROP COLUMN IF EXISTS "received_cost_units"`);
    await q.query(`ALTER TABLE "vendor_bill_line" DROP COLUMN IF EXISTS "received_cost_absorbed"`);
    await q.query(`ALTER TABLE "vendor_bills" DROP COLUMN IF EXISTS "receipt_warehouse_id"`);
  }
}
