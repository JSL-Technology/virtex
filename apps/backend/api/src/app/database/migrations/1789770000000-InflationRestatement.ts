import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Restatement for inflation (IAS 29; Argentina RT 6, Venezuela BA VEN-NIF 2). Audit 2026-11-07,
 * FIN-AC-04.
 *
 * The adjustment read a «monthly rate» per organization from `inflation_indices` — no endpoint to
 * load it, 0 rows — and multiplied each balance at the END of the month by it, with no notion of
 * when an amount originated and nothing to stop the same month being restated twice. This is the
 * schema of the replacement:
 *
 *  - `price_index_values`: the published months of each market's general price index, shared by
 *    every company and versioned by revision. The series are the markets' (`AR-FACPCE`,
 *    `VE-BCV-INPC`); no value is invented here — the platform loads the official publication.
 *  - `tenant_price_index_values`: a month a company records for itself while the published one is
 *    missing, under the tenant policy. Both are append-only for the application role: a correction
 *    is the next revision, never an UPDATE.
 *  - `organization_settings.inflation_adjustment_policy` and `inflation_index_series_code`: when the
 *    close restates, and with which index. The companies of AR and VE whose books are in the
 *    index's currency start at `YEAR_END`; everyone else at `NONE`.
 *  - `accounts.is_inflation_adjustable` gets its meaning — every postable non-monetary account, no
 *    monetary one, never the account of the net monetary position — and
 *    `inflation_adjustment_account_id` the account a restatement goes to when the account stays at
 *    nominal value. Existing Argentine companies get «Ajuste de Capital» beside capital, as new ones
 *    do from the opening plan.
 *  - `journal_entry_lines.origin_date`: when an amount originated, where not on the entry's date.
 *  - `inflation_adjustment_runs` and their lines: one POSTED run per ledger and month, with the
 *    index of every month it used.
 *
 * `inflation_indices` is retired; the migration stops if anybody put rows in it by hand, rather
 * than deleting figures a person typed.
 */
export class InflationRestatement1789770000000 implements MigrationInterface {
  name = 'InflationRestatement1789770000000';

  /** A literal snapshot of the markets' declarations (`MarketAccounting.inflationAccounting`). */
  private static readonly MARKETS: ReadonlyArray<{ country: string; series: string; currency: string; policy: string }> = [
    { country: 'AR', series: 'AR-FACPCE', currency: 'ARS', policy: 'YEAR_END' },
    { country: 'VE', series: 'VE-BCV-INPC', currency: 'VES', policy: 'YEAR_END' },
  ];

  public async up(q: QueryRunner): Promise<void> {
    // Deferred checks run as each statement ends: this migration alters tables it also writes to,
    // and PostgreSQL refuses an ALTER TABLE on a table with checks still pending.
    await q.query(`SET CONSTRAINTS ALL IMMEDIATE`);
    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;
    const isolate = async (table: string) => {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING ("organization_id" = ${setting}::uuid)
          WITH CHECK ("organization_id" = ${setting}::uuid)`);
    };
    const appRole = async (statement: string) => {
      await q.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN ${statement}; END IF;
        END $$`);
    };

    // ── The old table ──────────────────────────────────────────────────────────────────────
    const [{ count }] = await q.query(`SELECT COUNT(*)::int AS count FROM "inflation_indices"`);
    if (count > 0) {
      throw new Error(
        `inflation_indices tiene ${count} filas cargadas a mano: revísalas y cárgalas como índices de la serie de su mercado antes de migrar.`,
      );
    }
    await q.query(`DROP TABLE "inflation_indices"`);

    // ── Price indices ──────────────────────────────────────────────────────────────────────
    for (const table of ['price_index_values', 'tenant_price_index_values']) {
      const tenant = table === 'tenant_price_index_values';
      await q.query(`
        CREATE TABLE "${table}" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          ${tenant ? `"organization_id" uuid NOT NULL,` : ''}
          "series_code" character varying(40) NOT NULL,
          "period" date NOT NULL,
          "value" numeric(30,10) NOT NULL,
          "revision" integer NOT NULL,
          "published_on" date,
          "reference" text,
          "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "recorded_by_user_id" uuid,
          CONSTRAINT "PK_${table}" PRIMARY KEY ("id"),
          ${tenant ? `CONSTRAINT "FK_tenant_price_index_values_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,` : ''}
          CONSTRAINT "CHK_${table}_value" CHECK ("value" > 0),
          CONSTRAINT "CHK_${table}_period" CHECK (EXTRACT(DAY FROM "period") = 1),
          CONSTRAINT "CHK_${table}_revision" CHECK ("revision" >= 1),
          CONSTRAINT "CHK_${table}_series" CHECK ("series_code" ~ '^[A-Z]{2}-[A-Z0-9-]{1,37}$')
        )`);
      await q.query(
        tenant
          ? `CREATE UNIQUE INDEX "UQ_tenant_price_index_values_revision" ON "tenant_price_index_values" ("organization_id", "series_code", "period", "revision")`
          : `CREATE UNIQUE INDEX "UQ_price_index_values_revision" ON "price_index_values" ("series_code", "period", "revision")`,
      );
      if (tenant) await isolate(table);
      // Append-only for the application: a correction is the next revision, and a restatement run
      // must always be able to say which figure it multiplied by.
      await appRole(`GRANT SELECT, INSERT ON "${table}" TO virtex_app; REVOKE UPDATE, DELETE ON "${table}" FROM virtex_app`);
    }

    // ── Settings: when the close restates, and with which index ─────────────────────────────
    await q.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN "inflation_adjustment_policy" character varying(16) NOT NULL DEFAULT 'NONE',
        ADD COLUMN "inflation_index_series_code" character varying(40),
        ADD CONSTRAINT "CHK_organization_settings_inflation_adjustment_policy"
          CHECK ("inflation_adjustment_policy" IN ('NONE', 'YEAR_END', 'EVERY_PERIOD'))`);
    for (const market of InflationRestatement1789770000000.MARKETS) {
      await q.query(
        `UPDATE "organization_settings" s
            SET "inflation_index_series_code" = COALESCE(s."inflation_index_series_code", $2),
                "inflation_adjustment_policy" = CASE WHEN UPPER(COALESCE(s."base_currency", '')) = $3 THEN $4 ELSE s."inflation_adjustment_policy" END
           FROM "organizations" o
          WHERE o."id" = s."organization_id" AND UPPER(COALESCE(o."country", '')) = $1`,
        [market.country, market.series, market.currency, market.policy],
      );
    }

    // ── Accounts: which are restated, and where to ──────────────────────────────────────────
    await q.query(`ALTER TABLE "accounts" ADD COLUMN "inflation_adjustment_account_id" uuid`);
    await q.query(`
      ALTER TABLE "accounts" ADD CONSTRAINT "FK_accounts_inflation_adjustment_account"
        FOREIGN KEY ("inflation_adjustment_account_id") REFERENCES "accounts"("id")
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`);
    await q.query(`
      CREATE UNIQUE INDEX "UQ_accounts_inflation_adjustment_account" ON "accounts" ("organization_id", "inflation_adjustment_account_id")
        WHERE "inflation_adjustment_account_id" IS NOT NULL`);
    // Every postable non-monetary account, as `defaultInflationRestatement` decides it. Nothing set
    // the flag before: no screen, no import, and the old service the only reader.
    await q.query(`
      UPDATE "accounts" SET "is_inflation_adjustable" = (
        "isPostable"
        AND "system_role" IS DISTINCT FROM 'INFLATION_ADJUSTMENT'
        AND ("type" IN ('REVENUE', 'EXPENSE', 'EQUITY') OR ("type" IN ('ASSET', 'LIABILITY') AND "fx_treatment" <> 'REVALUED'))
      )`);
    await q.query(`
      ALTER TABLE "accounts"
        ADD CONSTRAINT "CHK_accounts_inflation_restatement_non_monetary"
          CHECK (NOT "is_inflation_adjustable" OR ("isPostable" AND "fx_treatment" = 'HISTORICAL' AND "system_role" IS DISTINCT FROM 'INFLATION_ADJUSTMENT')),
        ADD CONSTRAINT "CHK_accounts_inflation_adjustment_account"
          CHECK ("inflation_adjustment_account_id" IS NULL OR ("is_inflation_adjustable" AND "inflation_adjustment_account_id" <> "id"))`);

    // Argentina keeps capital at its nominal value with «Ajuste de Capital» beside it (RT 8/9):
    // the opening plan of a new company has it (`restatementAccounts` of the market); the ones
    // already created get it here, under capital's parent, and capital points at it.
    await q.query(`
      WITH source AS (
        SELECT a."id", a."organization_id", a."parent_id", a."effective_from", COALESCE(o."books_language", 'es') AS "language"
          FROM "accounts" a
          JOIN "organizations" o ON o."id" = a."organization_id"
         WHERE UPPER(COALESCE(o."country", '')) = 'AR' AND a."code" = '3100' AND a."type" = 'EQUITY' AND a."isPostable"
           AND a."inflation_adjustment_account_id" IS NULL
           AND NOT EXISTS (SELECT 1 FROM "accounts" b WHERE b."organization_id" = a."organization_id" AND b."code" = '3110')
      ), created AS (
        INSERT INTO "accounts" ("name", "type", "category", "nature", "isActive", "isPostable", "isSystemAccount", "parent_id",
                                "fx_treatment", "is_inflation_adjustable", "effective_from", "organization_id", "version", "code",
                                "is_contra_account")
        SELECT jsonb_build_object(source."language", 'Ajuste de Capital'), 'EQUITY', 'OWNERS_EQUITY', 'CREDIT', true, true, false,
               source."parent_id", 'HISTORICAL', false, source."effective_from", source."organization_id", 1, '3110', false
          FROM source
        RETURNING "id", "organization_id", "parent_id"
      ), segments AS (
        INSERT INTO "account_segments" ("order", "value", "account_id") SELECT 0, '3110', created."id" FROM created
      ), hierarchy AS (
        INSERT INTO "account_hierarchy_versions" ("accountId", "parentId", "effectiveDate")
        SELECT created."id", created."parent_id", now() FROM created
      )
      UPDATE "accounts" a SET "inflation_adjustment_account_id" = created."id"
        FROM created
       WHERE a."organization_id" = created."organization_id" AND a."code" = '3100'`);

    // ── When an amount originated ───────────────────────────────────────────────────────────
    await q.query(`ALTER TABLE "journal_entry_lines" ADD COLUMN "origin_date" date`);

    // ── Runs ────────────────────────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "inflation_adjustment_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "ledger_id" uuid NOT NULL,
        "period" date NOT NULL,
        "entry_date" date NOT NULL,
        "series_code" character varying(40) NOT NULL,
        "closing_index" numeric(30,10) NOT NULL,
        "index_values" jsonb NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'POSTED',
        "journal_entry_id" uuid,
        "reversal_entry_id" uuid,
        "net_monetary_result" numeric(18,2) NOT NULL DEFAULT 0,
        "line_count" integer NOT NULL DEFAULT 0,
        "ran_by_user_id" uuid,
        "ran_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "reversed_at" TIMESTAMP WITH TIME ZONE,
        "reversed_by_user_id" uuid,
        "reversal_reason" text,
        CONSTRAINT "PK_inflation_adjustment_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inflation_adjustment_runs_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inflation_adjustment_runs_ledger" FOREIGN KEY ("ledger_id") REFERENCES "ledgers"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "FK_inflation_adjustment_runs_entry" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "FK_inflation_adjustment_runs_reversal" FOREIGN KEY ("reversal_entry_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "CHK_inflation_adjustment_runs_status" CHECK ("status" IN ('POSTED', 'REVERSED')),
        CONSTRAINT "CHK_inflation_adjustment_runs_period" CHECK (EXTRACT(DAY FROM "period") = 1)
      )`);
    // One restatement in the books per ledger and month: a retried request and a second close find it.
    await q.query(`
      CREATE UNIQUE INDEX "UQ_inflation_adjustment_runs_posted" ON "inflation_adjustment_runs" ("organization_id", "ledger_id", "period")
        WHERE "status" = 'POSTED'`);
    await q.query(`CREATE INDEX "IDX_inflation_adjustment_runs_org_period" ON "inflation_adjustment_runs" ("organization_id", "period")`);
    await isolate('inflation_adjustment_runs');

    await q.query(`
      CREATE TABLE "inflation_adjustment_run_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "posted_account_id" uuid NOT NULL,
        "dimensions" jsonb,
        "historical" numeric(18,2) NOT NULL,
        "restated" numeric(18,2) NOT NULL,
        "book_balance" numeric(18,2) NOT NULL,
        "adjustment" numeric(18,2) NOT NULL,
        "earliest_origin" date,
        CONSTRAINT "PK_inflation_adjustment_run_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inflation_adjustment_run_lines_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inflation_adjustment_run_lines_run" FOREIGN KEY ("run_id") REFERENCES "inflation_adjustment_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inflation_adjustment_run_lines_account" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "FK_inflation_adjustment_run_lines_posted_account" FOREIGN KEY ("posted_account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
      )`);
    await q.query(`CREATE INDEX "IDX_inflation_adjustment_run_lines_run" ON "inflation_adjustment_run_lines" ("run_id")`);
    await isolate('inflation_adjustment_run_lines');
    // Every new reference between tenant rows — accounts to accounts, runs to ledgers and entries,
    // lines to accounts — gets the same-tenant guard every other one has.
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`SET CONSTRAINTS ALL IMMEDIATE`);
    await q.query(`DROP TABLE IF EXISTS "inflation_adjustment_run_lines"`);
    await q.query(`DROP TABLE IF EXISTS "inflation_adjustment_runs"`);
    await q.query(`ALTER TABLE "journal_entry_lines" DROP COLUMN IF EXISTS "origin_date"`);

    // The reference first — its same-tenant guard, by the name its installer gives it, and the key —
    // so the rows below change with nothing left to check.
    await q.query(`
      DO $$ BEGIN
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON "accounts"', 'tg_same_tenant_' || substr(md5('FK_accounts_inflation_adjustment_account'), 1, 24));
      END $$`);
    await q.query(`ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "FK_accounts_inflation_adjustment_account"`);
    await q.query(`ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "CHK_accounts_inflation_adjustment_account"`);
    await q.query(`ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "CHK_accounts_inflation_restatement_non_monetary"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_accounts_inflation_adjustment_account"`);
    await q.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "inflation_adjustment_account_id"`);
    // «Ajuste de Capital» goes where nothing was posted to it.
    await q.query(`
      DELETE FROM "accounts" a
       USING "organizations" o
       WHERE o."id" = a."organization_id" AND UPPER(COALESCE(o."country", '')) = 'AR' AND a."code" = '3110'
         AND NOT EXISTS (SELECT 1 FROM "journal_entry_lines" l WHERE l."account_id" = a."id")`);
    await q.query(`UPDATE "accounts" SET "is_inflation_adjustable" = false`);

    await q.query(`ALTER TABLE "organization_settings" DROP CONSTRAINT IF EXISTS "CHK_organization_settings_inflation_adjustment_policy"`);
    await q.query(`ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "inflation_index_series_code"`);
    await q.query(`ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "inflation_adjustment_policy"`);

    await q.query(`DROP TABLE IF EXISTS "tenant_price_index_values"`);
    await q.query(`DROP TABLE IF EXISTS "price_index_values"`);

    // The table as it was: per organization, with its tenant policy.
    await q.query(`
      CREATE TABLE "inflation_indices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "year" integer NOT NULL,
        "month" integer NOT NULL,
        "rate" numeric(10,6) NOT NULL,
        "source" text,
        CONSTRAINT "PK_d2180142df8e2e8f055990372bb" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inflation_indices_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )`);
    await q.query(`CREATE UNIQUE INDEX "IDX_dbadfb5609df77118dbb765e1f" ON "inflation_indices" ("organization_id", "year", "month")`);
    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;
    await q.query(`ALTER TABLE "inflation_indices" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "inflation_indices" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "inflation_indices"
        USING ("organization_id" = ${setting}::uuid)
        WITH CHECK ("organization_id" = ${setting}::uuid)`);
  }
}
