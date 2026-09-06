import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The opening balance of a bank account becomes a journal entry.
 *
 * ## The defect
 *
 * `bank_accounts.opening_balance` and `opening_date` were written by `POST /treasury/bank-accounts`
 * and read by nothing at all. Every figure the product shows — the cash position, the balance
 * sheet, the trial balance, the cash flow statement — is derived from the general ledger, because
 * the ledger is the record. A balance that never reached the ledger was therefore invisible
 * everywhere, and invisible *consistently*: the cash position said zero, the balance sheet agreed
 * with the cash position, and the tenant had no way to see that the number it had typed was doing
 * nothing.
 *
 * The service now posts the balance against an equity or suspense account the caller names, and
 * this column records which entry did it — so the amount cannot be posted twice, and an auditor can
 * follow the bank account to the entry that opened it.
 *
 * ## What this migration does not do
 *
 * It does not post entries for balances already declared. There is no way to know which account
 * their counterpart belongs in — that is the accountant's decision, and guessing at retained
 * earnings would misstate retained earnings for every tenant that ever filled the field in. Those
 * rows keep their declared amount with a null entry id, which is exactly the state the service
 * treats as "declared but not posted".
 */
export class BankAccountOpeningEntry1788920000000 implements MigrationInterface {
  name = 'BankAccountOpeningEntry1788920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "opening_journal_entry_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "bank_accounts" DROP CONSTRAINT IF EXISTS "FK_bank_accounts_opening_journal_entry"`,
    );
    // SET NULL, not CASCADE: reversing the opening entry must not delete the bank account.
    await queryRunner.query(
      `ALTER TABLE "bank_accounts"
         ADD CONSTRAINT "FK_bank_accounts_opening_journal_entry"
         FOREIGN KEY ("opening_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bank_accounts" DROP CONSTRAINT IF EXISTS "FK_bank_accounts_opening_journal_entry"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bank_accounts" DROP COLUMN IF EXISTS "opening_journal_entry_id"`,
    );
  }
}
