import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The tax on a supplier bill is computed from its lines (audit 2026-11-07, CMP-02): each line may
 * carry its rate, and a bill whose stated tax departs from it beyond rounding records why.
 * Existing bills keep their figures; no rate is invented for their lines.
 */
export class PurchaseTaxComputed1789520000000 implements MigrationInterface {
  name = 'PurchaseTaxComputed1789520000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bill_line" ADD COLUMN "tax_rate" numeric(9,6)`);
    await q.query(`ALTER TABLE "vendor_bills" ADD COLUMN "tax_override_reason" text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bills" DROP COLUMN "tax_override_reason"`);
    await q.query(`ALTER TABLE "vendor_bill_line" DROP COLUMN "tax_rate"`);
  }
}
