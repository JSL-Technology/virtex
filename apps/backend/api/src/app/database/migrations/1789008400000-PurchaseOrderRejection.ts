import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A purchase order can be rejected with a reason (QA A-11).
 *
 * The only way to refuse one was «reopen», which put it back to draft without a word: the requester
 * could not tell a rejection from an edit. The reason, its author and its time are kept on the
 * order until it is submitted again.
 */
export class PurchaseOrderRejection1789008400000 implements MigrationInterface {
  name = 'PurchaseOrderRejection1789008400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "purchase_orders"
        ADD COLUMN IF NOT EXISTS "rejection_reason" text,
        ADD COLUMN IF NOT EXISTS "rejected_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "purchase_orders"
        DROP COLUMN IF EXISTS "rejected_at",
        DROP COLUMN IF EXISTS "rejected_by_user_id",
        DROP COLUMN IF EXISTS "rejection_reason"
    `);
  }
}
