import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The column every balance in the product joins on was nullable and unindexed.
 *
 * `journal_entry_lines.journal_entry_id` carried a foreign key and nothing else. Two consequences,
 * on the hottest path in the system:
 *
 * - **No index.** Every balance, every financial statement, every ledger card and every daybook
 *   page joins a line to its entry — to read the entry's status, its date and its tenant, none of
 *   which live on the line. Without an index that join is a sequential scan of every journal line
 *   in the database, and the journal is the table that grows without bound.
 * - **Nullable.** An orphan line — one belonging to no entry — was storable. It has no status, so
 *   no `status = POSTED` filter excludes it; it has no date, so no period bounds it; it has no
 *   tenant, so the organization filter on the entry cannot reach it. It simply sits in the
 *   account's balance, and there is no report that would show it.
 *
 * Orphans are deleted rather than adopted: a line with no entry has no date, no status and no
 * tenant, so there is nothing to attach it to and no way to decide what it meant. On any database
 * where the application wrote the rows there are none, because lines are only ever created through
 * an entry's cascade.
 */
export class JournalLineEntryIndex1788900500000 implements MigrationInterface {
  name = 'JournalLineEntryIndex1788900500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "journal_entry_lines" WHERE "journal_entry_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines" ALTER COLUMN "journal_entry_id" SET NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_journal_entry_lines_entry"
      ON "journal_entry_lines" ("journal_entry_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_journal_entry_lines_entry"`);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines" ALTER COLUMN "journal_entry_id" DROP NOT NULL
    `);
  }
}
