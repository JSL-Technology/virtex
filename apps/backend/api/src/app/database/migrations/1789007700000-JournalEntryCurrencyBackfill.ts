import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every journal entry states its currency (QA A-12).
 *
 * Base-currency postings — customer receipts, vendor payments, payroll — were written with
 * `currency_code` NULL, and the entries list rendered NULL with the client's formatting default:
 * USD, in a company that keeps its books in DOP. `JournalEntriesService.prepare` now always
 * stamps the currency; this backfills the rows written before it did, with the currency those
 * amounts actually are in: the ledger's, which is what every valuation of the entry is kept in.
 *
 * Idempotent and data-only. `down` is a no-op: which rows were NULL is not recoverable, and a
 * stated currency that is correct is not something to take back.
 */
export class JournalEntryCurrencyBackfill1789007700000 implements MigrationInterface {
  name = 'JournalEntryCurrencyBackfill1789007700000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "journal_entries" je
         SET "currency_code" = l."currency"
        FROM "ledgers" l
       WHERE je."currency_code" IS NULL
         AND l."id" = je."ledger_id"
    `);
  }

  public async down(): Promise<void> {
    // Intentionally empty: see the class comment.
  }
}
