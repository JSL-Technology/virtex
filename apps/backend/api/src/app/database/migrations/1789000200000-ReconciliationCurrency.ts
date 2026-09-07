import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A bank statement records the currency its figures are in.
 *
 * ## Why reconciliation could not work for a foreign account
 *
 * Neither `bank_statements` nor `bank_transactions` carried a currency, and the CSV parser did not
 * read one. `ReconciliationService.writeMatch` therefore compared the statement's amounts — which
 * are in the bank account's currency — against `journal_entry_lines.debit − credit`, which is the
 * LEDGER's currency, and refused any match whose two sides did not coincidentally agree.
 * `summary` subtracted the same two currencies from one another to produce the very difference the
 * proof turns on. For a dollar account in a peso-based tenant, no match balanced, the difference
 * was never zero, and `closeStatement` was unreachable: the account could not be reconciled at all.
 *
 * The currency belongs on the statement rather than being read from the account at query time,
 * because an account's currency is a present fact and a statement is a historical document.
 *
 * Existing rows are backfilled from their account, which is where the figures came from.
 */
export class ReconciliationCurrency1789000200000 implements MigrationInterface {
  name = 'ReconciliationCurrency1789000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bank_statements"
        ADD COLUMN IF NOT EXISTS "currency_code" char(3)
    `);

    await queryRunner.query(`
      UPDATE "bank_statements" s
      SET "currency_code" = a."currency_code"
      FROM "bank_accounts" a
      WHERE a."id" = s."bank_account_id" AND s."currency_code" IS NULL
    `);

    // A statement whose account has since been deleted keeps its figures; the books' currency is
    // the only defensible reading left, and it is the one the old code assumed for every account.
    await queryRunner.query(`
      UPDATE "bank_statements" s
      SET "currency_code" = COALESCE(
        (SELECT l."currency" FROM "ledgers" l
          WHERE l."organization_id" = s."organization_id" AND l."is_default" = true LIMIT 1),
        'USD'
      )
      WHERE s."currency_code" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "bank_statements" ALTER COLUMN "currency_code" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bank_statements" DROP COLUMN IF EXISTS "currency_code"
    `);
  }
}
