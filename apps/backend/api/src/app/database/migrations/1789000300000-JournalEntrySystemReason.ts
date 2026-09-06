import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A posted entry records what produced it.
 *
 * ## Why the ledger needs this
 *
 * Every automatic posting already passed a `systemReason` — `fx-revaluation`, `approval-granted`,
 * `scheduled-accrual-reversal` — and it was written to the audit row and nowhere else. The ledger
 * itself therefore could not say what kind of transaction a posted entry was, and any report that
 * has to classify by origin was left to infer it from the accounts the entry happened to touch.
 *
 * The cash flow statement is where that inference fails outright. IAS 7.28 and ASC 230-10-45-25
 * require the effect of exchange-rate changes on cash to be presented as a separate reconciling
 * line, outside operating, investing and financing. The only thing that tells the unrealised
 * revaluation of a dollar bank account apart from a deposit into it is what posted it — by account
 * category the two are identical.
 *
 * Existing rows keep NULL: nothing can be reconstructed about who posted them, and a guess written
 * into the ledger is worse than an absence. Reports read NULL as "an ordinary transaction", which
 * is what every entry posted before this migration was treated as anyway.
 */
export class JournalEntrySystemReason1789000300000 implements MigrationInterface {
  name = 'JournalEntrySystemReason1789000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        ADD COLUMN IF NOT EXISTS "system_reason" varchar(64)
    `);

    // The cash flow statement asks for one reason over one tenant and date range at a time, and
    // the overwhelming majority of rows are NULL — a person's entry — so the index only carries
    // the ones a report will ever look for.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_journal_entries_org_system_reason"
        ON "journal_entries" ("organization_id", "system_reason")
        WHERE "system_reason" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_journal_entries_org_system_reason"`);
    await queryRunner.query(`ALTER TABLE "journal_entries" DROP COLUMN IF EXISTS "system_reason"`);
  }
}
