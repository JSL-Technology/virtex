import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make `analytical_report_data` refreshable.
 *
 * The hourly cron refreshes it with `REFRESH MATERIALIZED VIEW CONCURRENTLY`, and PostgreSQL
 * refuses that form unless the view carries a UNIQUE index with no WHERE clause. The view shipped
 * with two ordinary indexes and none unique, so every single run failed — the service caught the
 * error, logged "may need to be recreated" and carried on, which turned a broken refresh into a
 * line of noise instead of an alarm. The view therefore never held anything: analytical reporting
 * read an empty cube while the ledger underneath it filled up.
 *
 * The grain of the view is one row per (journal entry line × ledger) — that pair is already the
 * primary key of `journal_entry_line_valuations`, which the view joins one-to-one, so it is unique
 * by construction rather than by hope.
 */
export class AnalyticalViewUniqueIndex1789003400000 implements MigrationInterface {
  name = 'AnalyticalViewUniqueIndex1789003400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_analytical_report_data_line_ledger"
        ON "analytical_report_data" ("journal_entry_line_id", "ledger_id")
    `);
    // The view has been stale for as long as the index was missing; fill it once here so the first
    // report after this migration is not empty while waiting for the next cron tick.
    await q.query(`REFRESH MATERIALIZED VIEW "analytical_report_data"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_analytical_report_data_line_ledger"`);
  }
}
