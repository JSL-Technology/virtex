import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The opening balance of every existing bank account is its initial reconciliation (REC-01).
 *
 * Treasury now marks the bank-side line of the opening entry reconciled when it posts it. Accounts
 * created before that carry an opening line that sits in every reconciliation as an item "in the
 * books but not on the statement" for the whole opening amount, so none of their statements can
 * close. This marks those lines reconciled, once; it touches only the bank account's own GL line
 * of its own opening entry, and only lines not already reconciled. The reconciliation flags are
 * the one thing the ledger immutability guards allow to change on a posted line.
 */
export class BankOpeningReconciled1789330000000 implements MigrationInterface {
  name = 'BankOpeningReconciled1789330000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "journal_entry_lines" l
         SET "is_reconciled" = true,
             "reconciled_at" = COALESCE(l."reconciled_at", now())
        FROM "bank_accounts" b
       WHERE b."opening_journal_entry_id" = l."journal_entry_id"
         AND b."gl_account_id" = l."account_id"
         AND NOT l."is_reconciled"
    `);
  }

  public async down(): Promise<void> {
    // Not reversed: un-reconciling the opening would re-open every statement of every account.
  }
}
