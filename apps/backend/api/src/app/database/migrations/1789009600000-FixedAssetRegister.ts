import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The fixed-asset register, made a register (audit H-21).
 *
 * `fixed_asset` kept a cost in `numeric(10,2)`, a purchase timestamp, account ids in `varchar`
 * with no foreign key, and nothing about a disposal. See `FixedAsset` for each column's meaning,
 * and `FixedAssetDepreciation` for the per-month record of what every run charged.
 *
 * Existing rows are carried over, not rejected:
 *   * their number is allotted in acquisition order per year, and the series is seeded so the next
 *     asset registered continues it;
 *   * an account id that is not a uuid, or names no account, becomes null — it could only ever
 *     have failed at posting time, and the register now asks for it before the next run;
 *   * the three data constraints are validated when the rows satisfy them and otherwise left
 *     enforced for new writes only (`NOT VALID`), with a notice, rather than failing the upgrade.
 */
const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
const UUID = `'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`;
const FIXED_ASSET_SCOPE = '00000000-0000-4000-8000-000000000009';

export class FixedAssetRegister1789009600000 implements MigrationInterface {
  name = 'FixedAssetRegister1789009600000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "fixed_asset" RENAME CONSTRAINT "FK_7d983eb5abe24754533c4ad3bf9" TO "FK_fixed_asset_organization"`);

    // ── Columns renamed to the house convention, and given their real types ──
    await q.query(`ALTER TABLE "fixed_asset" RENAME COLUMN "purchaseDate" TO "acquisition_date"`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "acquisition_date" TYPE date USING "acquisition_date"::date`);
    await q.query(`ALTER TABLE "fixed_asset" RENAME COLUMN "usefulLife" TO "useful_life_months"`);
    await q.query(`ALTER TABLE "fixed_asset" RENAME COLUMN "residualValue" TO "residual_value"`);
    await q.query(`ALTER TABLE "fixed_asset" RENAME COLUMN "depreciationMethod" TO "depreciation_method"`);
    await q.query(`
      UPDATE "fixed_asset" SET "depreciation_method" = 'STRAIGHT_LINE'
       WHERE "depreciation_method" NOT IN ('STRAIGHT_LINE', 'DOUBLE_DECLINING_BALANCE', 'SUM_OF_YEARS_DIGITS')
    `);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "depreciation_method" TYPE varchar(32)`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "depreciation_method" SET DEFAULT 'STRAIGHT_LINE'`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "name" TYPE varchar(200)`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "description" TYPE text`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "description" DROP NOT NULL`);
    for (const column of ['cost', 'residual_value', 'book_value', 'accumulated_depreciation']) {
      await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "${column}" TYPE numeric(18,2)`);
    }
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "residual_value" SET DEFAULT 0`);

    // ── Number ──
    await q.query(`ALTER TABLE "fixed_asset" ADD "number" varchar(40)`);
    await q.query(`
      UPDATE "fixed_asset" f
         SET "number" = 'AF-' || to_char(f."acquisition_date", 'YYYY') || '-' || lpad(r.rn::text, 6, '0')
        FROM (SELECT "id", row_number() OVER (
                       PARTITION BY "organization_id", date_part('year', "acquisition_date")
                       ORDER BY "acquisition_date", "id") AS rn
                FROM "fixed_asset") r
       WHERE r."id" = f."id"
    `);
    await q.query(`
      INSERT INTO "journal_entry_sequences" ("organization_id", "journal_id", "year", "last_number")
      SELECT "organization_id", '${FIXED_ASSET_SCOPE}', date_part('year', "acquisition_date")::int, count(*)
        FROM "fixed_asset"
       GROUP BY "organization_id", date_part('year', "acquisition_date")
      ON CONFLICT ("organization_id", "journal_id", "year") DO UPDATE
        SET "last_number" = GREATEST("journal_entry_sequences"."last_number", EXCLUDED."last_number")
    `);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "number" SET NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fixed_asset_org_number" ON "fixed_asset" ("organization_id", "number")`);
    await q.query(`CREATE INDEX "IDX_fixed_asset_org_status" ON "fixed_asset" ("organization_id", "status")`);

    // ── Dates and opening balance ──
    await q.query(`ALTER TABLE "fixed_asset" ADD "in_service_date" date`);
    await q.query(`UPDATE "fixed_asset" SET "in_service_date" = "acquisition_date"`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "in_service_date" SET NOT NULL`);
    await q.query(`ALTER TABLE "fixed_asset" ADD "opening_accumulated_depreciation" numeric(18,2) NOT NULL DEFAULT 0`);

    // ── Accounts: uuid, nullable, and pointing at an account that exists ──
    for (const column of ['asset_account_id', 'accumulated_depreciation_account_id']) {
      await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "${column}" DROP NOT NULL`);
      await q.query(`
        ALTER TABLE "fixed_asset" ALTER COLUMN "${column}" TYPE uuid
          USING (CASE WHEN "${column}" ~ ${UUID} THEN "${column}"::uuid END)
      `);
      await q.query(`
        UPDATE "fixed_asset" f SET "${column}" = NULL
         WHERE "${column}" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = f."${column}")
      `);
    }
    await q.query(`ALTER TABLE "fixed_asset" ADD "depreciation_expense_account_id" uuid`);
    await q.query(`ALTER TABLE "fixed_asset" ADD "vendor_bill_id" uuid`);
    await q.query(`ALTER TABLE "fixed_asset" ADD "branch_id" uuid`);

    // ── Disposal and authorship ──
    await q.query(`ALTER TABLE "fixed_asset" ADD "disposal_date" date`);
    await q.query(`ALTER TABLE "fixed_asset" ADD "disposal_proceeds" numeric(18,2)`);
    await q.query(`ALTER TABLE "fixed_asset" ADD "disposal_reason" text`);
    await q.query(`ALTER TABLE "fixed_asset" ADD "disposal_journal_entry_id" uuid`);
    await q.query(`ALTER TABLE "fixed_asset" ADD "disposed_by_user_id" uuid`);
    await q.query(`ALTER TABLE "fixed_asset" ADD "created_by_user_id" uuid`);
    await q.query(`ALTER TABLE "fixed_asset" ADD "created_at" timestamptz NOT NULL DEFAULT now()`);
    await q.query(`ALTER TABLE "fixed_asset" ADD "updated_at" timestamptz NOT NULL DEFAULT now()`);

    const fk = (name: string, column: string, target: string, onDelete: string) =>
      q.query(`
        ALTER TABLE "fixed_asset" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}")
          REFERENCES "${target}"("id") ON DELETE ${onDelete}
      `);
    await fk('FK_fixed_asset_asset_account', 'asset_account_id', 'accounts', 'NO ACTION');
    await fk('FK_fixed_asset_accumulated_account', 'accumulated_depreciation_account_id', 'accounts', 'NO ACTION');
    await fk('FK_fixed_asset_expense_account', 'depreciation_expense_account_id', 'accounts', 'NO ACTION');
    await fk('FK_fixed_asset_vendor_bill', 'vendor_bill_id', 'vendor_bills', 'SET NULL');
    await fk('FK_fixed_asset_branch', 'branch_id', 'branches', 'NO ACTION');
    await fk('FK_fixed_asset_disposal_entry', 'disposal_journal_entry_id', 'journal_entries', 'NO ACTION');

    // ── Constraints ──
    await q.query(`ALTER TABLE "fixed_asset" ADD CONSTRAINT "CHK_fixed_asset_method"
      CHECK ("depreciation_method" IN ('STRAIGHT_LINE', 'DOUBLE_DECLINING_BALANCE', 'SUM_OF_YEARS_DIGITS'))`);
    const dataChecks: Array<[string, string]> = [
      ['CHK_fixed_asset_cost', `"cost" >= 0`],
      ['CHK_fixed_asset_residual', `"residual_value" >= 0 AND "residual_value" <= "cost"`],
      ['CHK_fixed_asset_useful_life', `"useful_life_months" > 0`],
      [
        'CHK_fixed_asset_accumulated',
        `"accumulated_depreciation" >= 0 AND "accumulated_depreciation" <= "cost" - "residual_value"`,
      ],
    ];
    for (const [name, expression] of dataChecks) {
      await q.query(`ALTER TABLE "fixed_asset" ADD CONSTRAINT "${name}" CHECK (${expression}) NOT VALID`);
      await q.query(`
        DO $$
        BEGIN
          ALTER TABLE "fixed_asset" VALIDATE CONSTRAINT "${name}";
        EXCEPTION WHEN check_violation THEN
          RAISE NOTICE '${name}: existing rows violate it; enforced for new writes only until corrected';
        END $$
      `);
    }

    // ── What each run charged, month by month ──
    await q.query(`
      CREATE TABLE "fixed_asset_depreciations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "fixed_asset_id" uuid NOT NULL,
        "period_end" date NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "accumulated_after" numeric(18,2) NOT NULL,
        "book_value_after" numeric(18,2) NOT NULL,
        "journal_entry_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fixed_asset_depreciations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fixed_asset_depreciations_amount" CHECK ("amount" > 0),
        CONSTRAINT "FK_fixed_asset_depreciations_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_fixed_asset_depreciations_asset" FOREIGN KEY ("fixed_asset_id")
          REFERENCES "fixed_asset"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_fixed_asset_depreciations_entry" FOREIGN KEY ("journal_entry_id")
          REFERENCES "journal_entries"("id") ON DELETE NO ACTION
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX "UQ_fixed_asset_depreciations_asset_period"
        ON "fixed_asset_depreciations" ("fixed_asset_id", "period_end")
    `);
    await q.query(`
      CREATE INDEX "IDX_fixed_asset_depreciations_org_period"
        ON "fixed_asset_depreciations" ("organization_id", "period_end")
    `);
    await q.query(`ALTER TABLE "fixed_asset_depreciations" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "fixed_asset_depreciations" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "fixed_asset_depreciations"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "fixed_asset_depreciations"`);
    for (const name of [
      'CHK_fixed_asset_accumulated',
      'CHK_fixed_asset_useful_life',
      'CHK_fixed_asset_residual',
      'CHK_fixed_asset_cost',
      'CHK_fixed_asset_method',
      'FK_fixed_asset_disposal_entry',
      'FK_fixed_asset_branch',
      'FK_fixed_asset_vendor_bill',
      'FK_fixed_asset_expense_account',
      'FK_fixed_asset_accumulated_account',
      'FK_fixed_asset_asset_account',
    ]) {
      await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "${name}"`);
    }
    for (const column of [
      'updated_at',
      'created_at',
      'created_by_user_id',
      'disposed_by_user_id',
      'disposal_journal_entry_id',
      'disposal_reason',
      'disposal_proceeds',
      'disposal_date',
      'branch_id',
      'vendor_bill_id',
      'depreciation_expense_account_id',
      'opening_accumulated_depreciation',
      'in_service_date',
    ]) {
      await q.query(`ALTER TABLE "fixed_asset" DROP COLUMN "${column}"`);
    }
    await q.query(`DROP INDEX IF EXISTS "IDX_fixed_asset_org_status"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_fixed_asset_org_number"`);
    await q.query(`DELETE FROM "journal_entry_sequences" WHERE "journal_id" = '${FIXED_ASSET_SCOPE}'`);
    await q.query(`ALTER TABLE "fixed_asset" DROP COLUMN "number"`);
    for (const column of ['asset_account_id', 'accumulated_depreciation_account_id']) {
      await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "${column}" TYPE varchar USING "${column}"::text`);
      await q.query(`UPDATE "fixed_asset" SET "${column}" = '' WHERE "${column}" IS NULL`);
      await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "${column}" SET NOT NULL`);
    }
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "residual_value" DROP DEFAULT`);
    for (const column of ['cost', 'residual_value', 'book_value', 'accumulated_depreciation']) {
      await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "${column}" TYPE numeric(10,2)`);
    }
    await q.query(`UPDATE "fixed_asset" SET "description" = '' WHERE "description" IS NULL`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "description" TYPE varchar`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "description" SET NOT NULL`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "name" TYPE varchar`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "depreciation_method" DROP DEFAULT`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "depreciation_method" TYPE varchar`);
    await q.query(`ALTER TABLE "fixed_asset" RENAME COLUMN "depreciation_method" TO "depreciationMethod"`);
    await q.query(`ALTER TABLE "fixed_asset" RENAME COLUMN "residual_value" TO "residualValue"`);
    await q.query(`ALTER TABLE "fixed_asset" RENAME COLUMN "useful_life_months" TO "usefulLife"`);
    await q.query(`ALTER TABLE "fixed_asset" ALTER COLUMN "acquisition_date" TYPE timestamp USING "acquisition_date"::timestamp`);
    await q.query(`ALTER TABLE "fixed_asset" RENAME COLUMN "acquisition_date" TO "purchaseDate"`);
    await q.query(`ALTER TABLE "fixed_asset" RENAME CONSTRAINT "FK_fixed_asset_organization" TO "FK_7d983eb5abe24754533c4ad3bf9"`);
  }
}
