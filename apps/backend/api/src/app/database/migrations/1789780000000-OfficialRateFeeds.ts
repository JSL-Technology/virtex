import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Official exchange-rate feeds (audit 2026-11-07, FINB-03): the state of each market's feed in this
 * deployment, and the log of every reading.
 *
 * Both are global — a feed's figures are the market's, not a company's — and written only by the
 * platform: the scheduled job and the platform's operators. The run log is append-only for the
 * application's role: a reading is recorded once, when it ends, and never edited.
 */
export class OfficialRateFeeds1789780000000 implements MigrationInterface {
  name = 'OfficialRateFeeds1789780000000';

  public async up(q: QueryRunner): Promise<void> {
    const appRole = async (statement: string) => {
      await q.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN ${statement}; END IF;
        END $$`);
    };

    await q.query(`
      CREATE TABLE "exchange_rate_feeds" (
        "code" varchar(40) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'SHADOW',
        "status_changed_at" timestamptz,
        "status_changed_by" uuid,
        "last_run_at" timestamptz,
        "last_success_at" timestamptz,
        "consecutive_failures" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_exchange_rate_feeds" PRIMARY KEY ("code"),
        CONSTRAINT "CHK_exchange_rate_feeds_status" CHECK ("status" IN ('SHADOW', 'ACTIVE', 'DISABLED')),
        CONSTRAINT "CHK_exchange_rate_feeds_failures" CHECK ("consecutive_failures" >= 0)
      )`);

    await q.query(`
      CREATE TABLE "exchange_rate_feed_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "feed_code" varchar(40) NOT NULL,
        "trigger" varchar(16) NOT NULL,
        "requested_by" uuid,
        "mode" varchar(16) NOT NULL,
        "range_from" date NOT NULL,
        "range_to" date NOT NULL,
        "status" varchar(16) NOT NULL,
        "reason" varchar(80),
        "detail" jsonb,
        "quotes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "written" integer NOT NULL DEFAULT 0,
        "unchanged" integer NOT NULL DEFAULT 0,
        "discrepancies" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "started_at" timestamptz NOT NULL,
        "finished_at" timestamptz NOT NULL,
        CONSTRAINT "PK_exchange_rate_feed_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_exchange_rate_feed_runs_feed" FOREIGN KEY ("feed_code") REFERENCES "exchange_rate_feeds"("code"),
        CONSTRAINT "CHK_exchange_rate_feed_runs_status" CHECK ("status" IN ('SUCCEEDED', 'FAILED', 'SKIPPED')),
        CONSTRAINT "CHK_exchange_rate_feed_runs_trigger" CHECK ("trigger" IN ('SCHEDULE', 'OPERATOR')),
        CONSTRAINT "CHK_exchange_rate_feed_runs_mode" CHECK ("mode" IN ('SHADOW', 'ACTIVE')),
        CONSTRAINT "CHK_exchange_rate_feed_runs_range" CHECK ("range_from" <= "range_to"),
        CONSTRAINT "CHK_exchange_rate_feed_runs_counts" CHECK ("written" >= 0 AND "unchanged" >= 0)
      )`);
    await q.query(`CREATE INDEX "IDX_exchange_rate_feed_runs_feed" ON "exchange_rate_feed_runs" ("feed_code", "started_at")`);

    await appRole(`GRANT SELECT, INSERT, UPDATE ON "exchange_rate_feeds" TO virtex_app; REVOKE DELETE ON "exchange_rate_feeds" FROM virtex_app`);
    await appRole(`GRANT SELECT, INSERT ON "exchange_rate_feed_runs" TO virtex_app; REVOKE UPDATE, DELETE ON "exchange_rate_feed_runs" FROM virtex_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "exchange_rate_feed_runs"`);
    await q.query(`DROP TABLE "exchange_rate_feeds"`);
  }
}
