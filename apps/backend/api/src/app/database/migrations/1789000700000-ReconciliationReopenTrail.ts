import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reopening a reconciliation stops erasing the record of the reconciliation.
 *
 * `reopenStatement` set `reconciled_at` and `reconciled_by_user_id` back to NULL. Those two
 * columns were the entire record that the statement had ever been reconciled and who signed it
 * off, and no audit row was written anywhere either — so reopening a closed bank reconciliation
 * left no trace that it had been closed, by whom, or that anybody had undone it.
 *
 * Undoing a control by deleting the evidence that the control was applied is the pattern an
 * external auditor tests for specifically, and it is the one thing a reconciliation module must
 * not do: the closure is the assertion that the bank and the books agreed, and the assertion is
 * worthless if it can be silently withdrawn.
 *
 * The closing columns now stay put and the reopening is recorded beside them, with its author, its
 * time and its reason.
 */
export class ReconciliationReopenTrail1789000700000 implements MigrationInterface {
  name = 'ReconciliationReopenTrail1789000700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bank_statements"
        ADD COLUMN IF NOT EXISTS "reopened_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "reopened_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "reopen_reason" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bank_statements"
        DROP COLUMN IF EXISTS "reopened_at",
        DROP COLUMN IF EXISTS "reopened_by_user_id",
        DROP COLUMN IF EXISTS "reopen_reason"
    `);
  }
}
