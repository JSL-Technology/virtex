import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The ledger becomes the single source of truth for balances, and every entry gets an identity.
 *
 * ## The two balance tables go away
 *
 * `account_balances` held one cumulative figure per (account, ledger) with no period dimension,
 * maintained by a BullMQ worker that applied deltas *after* the posting transaction committed. A
 * job that exhausted its retries, or a worker that died between the SQL commit and the queue
 * acknowledgement, left the figure permanently wrong, and nothing could detect or recompute it.
 * Because the figure was cumulative and had no period, "carry balances into the next period" was
 * expressed as a journal entry re-posting every balance-sheet account — which the worker then added
 * on top of the balance it was supposed to be carrying, so the balance sheet doubled at every close.
 *
 * `monthly_account_balances` was queried by the balance sheet and the income statement with a
 * predicate on `mb.ledgerId`, a column that appears in no migration and no entity: their primary
 * code path could only raise `column mb.ledgerId does not exist`. It also had no writer —
 * `ReportingService`, the nightly job meant to populate it, was declared in no module — so the
 * table was empty in every deployment. Its `account_id` column was a second, always-NULL foreign
 * key alongside the `accountId` primary key column.
 *
 * Both are dropped. Balances are `SUM`s over `journal_entry_line_valuations` joined to their entry,
 * computed at read time, which cannot drift from the journal because it is the journal. The indexes
 * added below are what make that affordable: `journal_entries` previously carried no index at all
 * beyond its primary key and three unique constraints, and `journal_entry_lines` had none on the
 * account every balance query groups by.
 *
 * ## Entries get a consecutive number and an author
 *
 * `journal_entries` identified an entry only by its UUID, shown to users as `JE-` plus eight
 * characters of it. The libro diario has to be a consecutive series without gaps in the Dominican
 * Republic, and the same requirement exists as `NumUnIdenPol` in Mexico's contabilidad electrónica
 * and in Colombia, Peru and Ecuador. Nor was there any record of who posted, reversed or modified
 * anything: the audit service was invoked exactly once in the whole accounting module, for
 * reopening a period.
 *
 * Existing posted entries are backfilled into a per (tenant, journal, year) series ordered by date
 * and creation time, and `journal_entry_sequences` is primed so the next allocation continues from
 * there rather than colliding.
 *
 * ## Audit rows for unattended work
 *
 * `audit_logs.user_id` was NOT NULL, so depreciation, recurring entries and scheduled reversals —
 * which have no user behind them — could not be audited at all. It becomes nullable; the payload
 * carries `systemReason` naming the process that acted.
 */
export class LedgerIntegrity1788700000000 implements MigrationInterface {
  name = 'LedgerIntegrity1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Derived balances: drop the stored ones ────────────────────────────────
    await queryRunner.query(`DROP TABLE IF EXISTS "account_balances"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "monthly_account_balances"`);

    // ── Entry identity ────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "entry_number" character varying(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "posted_by_user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "posted_at" TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "journal_entry_sequences" (
        "organization_id" uuid NOT NULL,
        "journal_id" uuid NOT NULL,
        "year" integer NOT NULL,
        "last_number" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_journal_entry_sequences" PRIMARY KEY ("organization_id", "journal_id", "year")
      )
    `);

    // Backfill in a deterministic order — date, then creation time, then id — so a re-run on a
    // restored dump produces the same numbers, and so the series reflects the order the entries
    // were actually booked in.
    await queryRunner.query(`
      WITH numbered AS (
        SELECT
          e."id",
          j."code" AS journal_code,
          EXTRACT(YEAR FROM e."date")::int AS entry_year,
          ROW_NUMBER() OVER (
            PARTITION BY e."organization_id", e."journal_id", EXTRACT(YEAR FROM e."date")
            ORDER BY e."date", e."created_at", e."id"
          ) AS ordinal
        FROM "journal_entries" e
        JOIN "journals" j ON j."id" = e."journal_id"
        WHERE e."status" = 'Posted' AND e."entry_number" IS NULL
      )
      UPDATE "journal_entries" e
      SET "entry_number" = numbered.journal_code || '-' || numbered.entry_year || '-' ||
                           LPAD(numbered.ordinal::text, 6, '0')
      FROM numbered
      WHERE e."id" = numbered."id"
    `);

    await queryRunner.query(`
      INSERT INTO "journal_entry_sequences" ("organization_id", "journal_id", "year", "last_number")
      SELECT
        e."organization_id",
        e."journal_id",
        EXTRACT(YEAR FROM e."date")::int,
        COUNT(*)::int
      FROM "journal_entries" e
      WHERE e."status" = 'Posted' AND e."entry_number" IS NOT NULL
      GROUP BY e."organization_id", e."journal_id", EXTRACT(YEAR FROM e."date")
      ON CONFLICT ("organization_id", "journal_id", "year") DO UPDATE
        SET "last_number" = GREATEST(
          "journal_entry_sequences"."last_number",
          EXCLUDED."last_number"
        )
    `);

    // Posted entries whose author is unknown stay NULL rather than being attributed to someone.
    // A fabricated author is worse than an acknowledged gap.
    await queryRunner.query(`
      UPDATE "journal_entries"
      SET "posted_at" = "created_at"
      WHERE "status" = 'Posted' AND "posted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_journal_entries_org_entry_number"
      ON "journal_entries" ("organization_id", "entry_number")
      WHERE "entry_number" IS NOT NULL
    `);

    // ── Indexes the derived balances depend on ────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_journal_entries_org_status_date"
      ON "journal_entries" ("organization_id", "status", "date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_journal_entry_lines_account"
      ON "journal_entry_lines" ("account_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_journal_entry_line_valuations_ledger"
      ON "journal_entry_line_valuations" ("ledger_id")
    `);

    // ── Audit rows for unattended work ────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "user_id" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "user_id" SET NOT NULL`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_journal_entry_line_valuations_ledger"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_journal_entry_lines_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_journal_entries_org_status_date"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_journal_entries_org_entry_number"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "journal_entry_sequences"`);
    await queryRunner.query(
      `ALTER TABLE "journal_entries" DROP COLUMN IF EXISTS "posted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" DROP COLUMN IF EXISTS "posted_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" DROP COLUMN IF EXISTS "entry_number"`,
    );

    // The balance tables are recreated empty. Their contents were a cache of the journal and are
    // recomputed by whatever reads them; there is nothing here that the journal does not already
    // hold.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "account_balances" (
        "account_id" uuid NOT NULL,
        "ledger_id" uuid NOT NULL,
        "balance" numeric(18,2) NOT NULL DEFAULT '0',
        "balance_in_foreign_currency" numeric(18,2),
        "last_updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_account_balances" PRIMARY KEY ("account_id", "ledger_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "monthly_account_balances" (
        "accountId" uuid NOT NULL,
        "year" integer NOT NULL,
        "month" integer NOT NULL,
        "organizationId" uuid NOT NULL,
        "totalDebit" numeric(18,2) NOT NULL DEFAULT '0',
        "totalCredit" numeric(18,2) NOT NULL DEFAULT '0',
        "endBalance" numeric(18,2) NOT NULL DEFAULT '0',
        "netChange" numeric(18,2) NOT NULL DEFAULT '0',
        CONSTRAINT "PK_monthly_account_balances"
          PRIMARY KEY ("accountId", "year", "month", "organizationId")
      )
    `);
  }
}
