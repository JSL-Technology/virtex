import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Voiding a till sale.
 *
 * `pos_sales.status` has always had a `CANCELLED` value and nothing ever set it: a ticket rung by
 * mistake stayed in the takings, its stock stayed out of the warehouse, and the only way to square
 * the drawer was a variance at close that nobody could explain. A supervisor can now void a sale
 * on a shift that is still open; the sale records who voided it, when and why, the stock goes back
 * and the shift keeps the voids apart from the takings so its report shows both.
 */
export class PosSaleVoids1789140100000 implements MigrationInterface {
  name = 'PosSaleVoids1789140100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "voided_at" timestamptz NULL`);
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "voided_by_id" uuid NULL`);
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "void_reason" varchar(255) NULL`);
    await q.query(`ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "voided_total" numeric(14,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "pos_shifts" ADD COLUMN IF NOT EXISTS "voided_count" integer NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "pos_shifts" DROP COLUMN IF EXISTS "voided_count"`);
    await q.query(`ALTER TABLE "pos_shifts" DROP COLUMN IF EXISTS "voided_total"`);
    await q.query(`ALTER TABLE "pos_sales" DROP COLUMN IF EXISTS "void_reason"`);
    await q.query(`ALTER TABLE "pos_sales" DROP COLUMN IF EXISTS "voided_by_id"`);
    await q.query(`ALTER TABLE "pos_sales" DROP COLUMN IF EXISTS "voided_at"`);
  }
}
