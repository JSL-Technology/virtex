import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How a till sale was paid (QA C-04).
 *
 * The point of sale registered every sale the instant «Cobrar» was pressed, without asking how the
 * customer paid, how much they handed over or what change they got. Every sale was booked as cash,
 * so the drawer never squared with the card terminal. A sale now records each tender — cash, card,
 * transfer, several of them for a mixed payment — what was handed over and the change returned.
 */
export class PosSalePayments1789010100000 implements MigrationInterface {
  name = 'PosSalePayments1789010100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "payments" jsonb NOT NULL DEFAULT '[]'`);
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "amount_tendered" numeric(14,2) NULL`);
    await q.query(`ALTER TABLE "pos_sales" ADD COLUMN IF NOT EXISTS "change_due" numeric(14,2) NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "pos_sales" DROP COLUMN IF EXISTS "change_due"`);
    await q.query(`ALTER TABLE "pos_sales" DROP COLUMN IF EXISTS "amount_tendered"`);
    await q.query(`ALTER TABLE "pos_sales" DROP COLUMN IF EXISTS "payments"`);
  }
}
