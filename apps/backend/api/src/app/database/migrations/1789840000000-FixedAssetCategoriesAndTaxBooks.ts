import { MigrationInterface, QueryRunner } from 'typeorm';

type Names = { es: string; en: string; pt: string };
const LANGUAGES = ['es', 'en', 'pt'] as const;

/**
 * The tax authorities' depreciation categories, as the market packages declare them today — a
 * literal snapshot, as a migration has to be (`markets/<cc>/accounting.ts`, `taxDepreciation`).
 * Starting points a local accountant confirms.
 */
const TAX_CATEGORIES: ReadonlyArray<[country: string, code: string, method: string, annualRate: number, names: Names]> = [
  ['DO', 'DO-1', 'DECLINING_BALANCE', 0.05, {"es": "Categoría 1 — Edificaciones y sus componentes estructurales (5 %)", "en": "Category 1 — Buildings and their structural components (5 %)", "pt": "Categoria 1 — Edificações e seus componentes estruturais (5 %)"}],
  ['DO', 'DO-2', 'DECLINING_BALANCE', 0.25, {"es": "Categoría 2 — Automóviles y camiones livianos, mobiliario y equipo de oficina, computadoras y equipo de procesamiento de datos (25 %)", "en": "Category 2 — Cars and light trucks, office furniture and equipment, computers and data-processing equipment (25 %)", "pt": "Categoria 2 — Automóveis e caminhões leves, mobiliário e equipamento de escritório, computadores e equipamento de processamento de dados (25 %)"}],
  ['DO', 'DO-3', 'DECLINING_BALANCE', 0.15, {"es": "Categoría 3 — Cualquier otra propiedad depreciable (15 %)", "en": "Category 3 — Any other depreciable property (15 %)", "pt": "Categoria 3 — Qualquer outro bem depreciável (15 %)"}],
  ['MX', 'MX-34-I', 'STRAIGHT_LINE', 0.05, {"es": "Construcciones (5 %)", "en": "Buildings (5 %)", "pt": "Construções (5 %)"}],
  ['MX', 'MX-34-III', 'STRAIGHT_LINE', 0.1, {"es": "Mobiliario y equipo de oficina (10 %)", "en": "Office furniture and equipment (10 %)", "pt": "Mobiliário e equipamento de escritório (10 %)"}],
  ['MX', 'MX-34-VI', 'STRAIGHT_LINE', 0.25, {"es": "Automóviles, autobuses, camiones de carga, tractocamiones, montacargas y remolques (25 %)", "en": "Cars, buses, freight trucks, tractor-trailers, forklifts and trailers (25 %)", "pt": "Automóveis, ônibus, caminhões de carga, cavalos mecânicos, empilhadeiras e reboques (25 %)"}],
  ['MX', 'MX-34-VII', 'STRAIGHT_LINE', 0.3, {"es": "Computadoras personales, servidores, impresoras y equipo periférico de cómputo (30 %)", "en": "Personal computers, servers, printers and computer peripherals (30 %)", "pt": "Computadores pessoais, servidores, impressoras e periféricos de informática (30 %)"}],
  ['MX', 'MX-34-VIII', 'STRAIGHT_LINE', 0.35, {"es": "Dados, troqueles, moldes, matrices y herramental (35 %)", "en": "Dies, punches, moulds, matrices and tooling (35 %)", "pt": "Matrizes, punções, moldes e ferramental (35 %)"}],
];

const METHODS = `'STRAIGHT_LINE', 'DOUBLE_DECLINING_BALANCE', 'SUM_OF_YEARS_DIGITS', 'DECLINING_BALANCE'`;
const CONVENTIONS = `'FULL_MONTH', 'NEXT_MONTH', 'MID_MONTH', 'DAILY'`;

/**
 * Asset categories and the tax book (audit 2026-11-07, FINB-16).
 *
 * - `fixed_asset_categories`: a company's classes of assets, with what an asset of each starts with —
 *   life, method, convention, residual share, accounts — and the tax category and rate its tax book
 *   starts from. Dominican and Mexican companies start with their authority's categories.
 * - `fixed_asset.category_id`, and `declining_annual_rate` for the method a tax law states: a fixed
 *   yearly rate on what is left (`DECLINING_BALANCE`).
 * - `fixed_asset_books` and `fixed_asset_book_charges`: an asset's tax book and the months it charged.
 *   A memorandum — it posts nothing; the tax return and the deferred tax read it.
 * - Runs record what they charged in the tax book (`tax_charge_count`, `tax_total`).
 */
export class FixedAssetCategoriesAndTaxBooks1789840000000 implements MigrationInterface {
  name = 'FixedAssetCategoriesAndTaxBooks1789840000000';

  public async up(q: QueryRunner): Promise<void> {
    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;
    const appRole = async (statement: string) => {
      await q.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN ${statement}; END IF;
        END $$`);
    };
    const tenantTable = async (table: string, grants: string) => {
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING ("organization_id" = ${setting}::uuid)
          WITH CHECK ("organization_id" = ${setting}::uuid)`);
      await appRole(grants.replace(/TABLE/g, `"${table}"`));
    };

    // ── Categories ────────────────────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "fixed_asset_categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "code" character varying(40) NOT NULL,
        "name" character varying(200) NOT NULL,
        "name_translations" jsonb NOT NULL DEFAULT '{}',
        "description" text,
        "useful_life_months" integer,
        "depreciation_method" character varying(32),
        "declining_annual_rate" numeric(7,6),
        "depreciation_convention" character varying(20),
        "residual_rate" numeric(7,6) NOT NULL DEFAULT 0,
        "asset_account_id" uuid,
        "accumulated_depreciation_account_id" uuid,
        "depreciation_expense_account_id" uuid,
        "gain_on_disposal_account_id" uuid,
        "loss_on_disposal_account_id" uuid,
        "tax_category_code" character varying(40),
        "tax_method" character varying(32),
        "tax_annual_rate" numeric(7,6),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fixed_asset_categories" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fixed_asset_categories_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_fixed_asset_categories_asset_account" FOREIGN KEY ("asset_account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_fixed_asset_categories_accumulated_account" FOREIGN KEY ("accumulated_depreciation_account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_fixed_asset_categories_expense_account" FOREIGN KEY ("depreciation_expense_account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_fixed_asset_categories_gain_account" FOREIGN KEY ("gain_on_disposal_account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_fixed_asset_categories_loss_account" FOREIGN KEY ("loss_on_disposal_account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION,
        CONSTRAINT "CHK_fixed_asset_categories_name_translations" CHECK (jsonb_typeof("name_translations") = 'object'),
        CONSTRAINT "CHK_fixed_asset_categories_life" CHECK ("useful_life_months" IS NULL OR "useful_life_months" > 0),
        CONSTRAINT "CHK_fixed_asset_categories_method" CHECK ("depreciation_method" IS NULL OR "depreciation_method" IN (${METHODS})),
        CONSTRAINT "CHK_fixed_asset_categories_declining_rate" CHECK ((COALESCE("depreciation_method", '') = 'DECLINING_BALANCE') = ("declining_annual_rate" IS NOT NULL) AND ("declining_annual_rate" IS NULL OR ("declining_annual_rate" > 0 AND "declining_annual_rate" <= 1))),
        CONSTRAINT "CHK_fixed_asset_categories_convention" CHECK ("depreciation_convention" IS NULL OR "depreciation_convention" IN (${CONVENTIONS})),
        CONSTRAINT "CHK_fixed_asset_categories_residual" CHECK ("residual_rate" >= 0 AND "residual_rate" < 1),
        CONSTRAINT "CHK_fixed_asset_categories_tax" CHECK (("tax_method" IS NULL) = ("tax_annual_rate" IS NULL) AND ("tax_method" IS NULL OR "tax_method" IN ('STRAIGHT_LINE', 'DECLINING_BALANCE')) AND ("tax_annual_rate" IS NULL OR ("tax_annual_rate" > 0 AND "tax_annual_rate" <= 1)))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fixed_asset_categories_org_code" ON "fixed_asset_categories" ("organization_id", "code")`);
    await tenantTable('fixed_asset_categories', `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE TO virtex_app`);

    // ── The asset: its category, and the rate of a declining balance ─────────────────────────
    await q.query(`ALTER TABLE "fixed_asset" ADD COLUMN "category_id" uuid`);
    await q.query(`
      ALTER TABLE "fixed_asset" ADD CONSTRAINT "FK_fixed_asset_category"
        FOREIGN KEY ("category_id") REFERENCES "fixed_asset_categories"("id") ON DELETE NO ACTION`);
    await q.query(`CREATE INDEX "IDX_fixed_asset_category" ON "fixed_asset" ("category_id")`);
    await q.query(`ALTER TABLE "fixed_asset" ADD COLUMN "declining_annual_rate" numeric(7,6)`);
    await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "CHK_fixed_asset_method"`);
    await q.query(`ALTER TABLE "fixed_asset" ADD CONSTRAINT "CHK_fixed_asset_method" CHECK ("depreciation_method" IN (${METHODS}))`);
    await q.query(`
      ALTER TABLE "fixed_asset" ADD CONSTRAINT "CHK_fixed_asset_declining_rate"
        CHECK (("depreciation_method" = 'DECLINING_BALANCE') = ("declining_annual_rate" IS NOT NULL) AND ("declining_annual_rate" IS NULL OR ("declining_annual_rate" > 0 AND "declining_annual_rate" <= 1)))`);

    // ── The tax book ──────────────────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "fixed_asset_books" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "fixed_asset_id" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "tax_category_code" character varying(40),
        "depreciation_method" character varying(32) NOT NULL,
        "annual_rate" numeric(7,6) NOT NULL,
        "depreciation_convention" character varying(20) NOT NULL,
        "cost" numeric(18,2) NOT NULL,
        "residual_value" numeric(18,2) NOT NULL DEFAULT 0,
        "accumulated_depreciation" numeric(18,2) NOT NULL DEFAULT 0,
        "opening_accumulated_depreciation" numeric(18,2) NOT NULL DEFAULT 0,
        "opening_through" date,
        "depreciated_through" date,
        "closed_on" date,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fixed_asset_books" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fixed_asset_books_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_fixed_asset_books_asset" FOREIGN KEY ("fixed_asset_id") REFERENCES "fixed_asset"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_fixed_asset_books_kind" CHECK ("kind" IN ('TAX')),
        CONSTRAINT "CHK_fixed_asset_books_method" CHECK ("depreciation_method" IN ('STRAIGHT_LINE', 'DECLINING_BALANCE')),
        CONSTRAINT "CHK_fixed_asset_books_rate" CHECK ("annual_rate" > 0 AND "annual_rate" <= 1),
        CONSTRAINT "CHK_fixed_asset_books_convention" CHECK ("depreciation_convention" IN (${CONVENTIONS})),
        CONSTRAINT "CHK_fixed_asset_books_amounts" CHECK ("cost" >= 0 AND "residual_value" >= 0 AND "residual_value" <= "cost"),
        CONSTRAINT "CHK_fixed_asset_books_accumulated" CHECK ("accumulated_depreciation" >= "opening_accumulated_depreciation" AND "opening_accumulated_depreciation" >= 0 AND "accumulated_depreciation" <= "cost" - "residual_value"),
        CONSTRAINT "CHK_fixed_asset_books_opening" CHECK (("opening_accumulated_depreciation" > 0) = ("opening_through" IS NOT NULL))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fixed_asset_books_asset_kind" ON "fixed_asset_books" ("fixed_asset_id", "kind")`);
    // A book is removed only while it has charged nothing; a book with charges is history, and the
    // charges' key refuses it at the database too.
    await tenantTable('fixed_asset_books', `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE TO virtex_app`);

    await q.query(`
      CREATE TABLE "fixed_asset_book_charges" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "book_id" uuid NOT NULL,
        "period_end" date NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "accumulated_after" numeric(18,2) NOT NULL,
        "book_value_after" numeric(18,2) NOT NULL,
        "run_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fixed_asset_book_charges" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fixed_asset_book_charges_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_fixed_asset_book_charges_book" FOREIGN KEY ("book_id") REFERENCES "fixed_asset_books"("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_fixed_asset_book_charges_run" FOREIGN KEY ("run_id") REFERENCES "fixed_asset_depreciation_runs"("id") ON DELETE NO ACTION,
        CONSTRAINT "CHK_fixed_asset_book_charges_amount" CHECK ("amount" > 0)
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_fixed_asset_book_charges_book_period" ON "fixed_asset_book_charges" ("book_id", "period_end")`);
    await q.query(`CREATE INDEX "IDX_fixed_asset_book_charges_org_period" ON "fixed_asset_book_charges" ("organization_id", "period_end")`);
    await q.query(`CREATE INDEX "IDX_fixed_asset_book_charges_run" ON "fixed_asset_book_charges" ("run_id")`);
    // History: a month charged is added and read, never changed.
    await tenantTable('fixed_asset_book_charges', `GRANT SELECT, INSERT ON TABLE TO virtex_app; REVOKE UPDATE, DELETE ON TABLE FROM virtex_app`);

    // ── Runs: what they charged in the tax book ──────────────────────────────────────────────
    await q.query(`ALTER TABLE "fixed_asset_depreciation_runs" ADD COLUMN "tax_charge_count" integer NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "fixed_asset_depreciation_runs" ADD COLUMN "tax_total" numeric(18,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "fixed_asset_depreciation_runs" DROP CONSTRAINT IF EXISTS "CHK_fixed_asset_depreciation_runs_totals"`);
    await q.query(`
      ALTER TABLE "fixed_asset_depreciation_runs" ADD CONSTRAINT "CHK_fixed_asset_depreciation_runs_totals"
        CHECK ("asset_count" > 0 AND "charge_count" >= 0 AND "tax_charge_count" >= 0 AND "charge_count" + "tax_charge_count" >= "asset_count" AND "total" >= 0 AND "tax_total" >= 0 AND ("total" > 0 OR "tax_total" > 0))`);

    // ── The authority's categories, for the companies of the markets that declare them ───────
    for (const [country, code, method, annualRate, names] of TAX_CATEGORIES) {
      for (const books of LANGUAGES) {
        const translations = JSON.stringify(Object.fromEntries(LANGUAGES.filter((language) => language !== books).map((language) => [language, names[language]])));
        await q.query(
          `INSERT INTO "fixed_asset_categories" ("organization_id", "code", "name", "name_translations", "tax_category_code", "tax_method", "tax_annual_rate")
           SELECT o."id", $1, $2, $3::jsonb, $1, $4, $5
             FROM "organizations" o
            WHERE upper(o."country") = $6 AND lower(left(COALESCE(o."books_language", 'es'), 2)) = $7
           ON CONFLICT ("organization_id", "code") DO NOTHING`,
          [code, names[books], translations, method, annualRate, country, books],
        );
      }
    }

    // Every reference above joins rows of one company to rows of the same company.
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    const dropGuard = async (table: string, constraint: string) =>
      q.query(`
        DO $$ BEGIN
          EXECUTE format('DROP TRIGGER IF EXISTS %I ON "${table}"', 'tg_same_tenant_' || substr(md5('${constraint}'), 1, 24));
        END $$`);
    await dropGuard('fixed_asset_book_charges', 'FK_fixed_asset_book_charges_book');
    await dropGuard('fixed_asset_book_charges', 'FK_fixed_asset_book_charges_run');
    await dropGuard('fixed_asset_books', 'FK_fixed_asset_books_asset');
    await dropGuard('fixed_asset', 'FK_fixed_asset_category');
    for (const constraint of ['FK_fixed_asset_categories_asset_account', 'FK_fixed_asset_categories_accumulated_account', 'FK_fixed_asset_categories_expense_account', 'FK_fixed_asset_categories_gain_account', 'FK_fixed_asset_categories_loss_account']) {
      await dropGuard('fixed_asset_categories', constraint);
    }

    await q.query(`ALTER TABLE "fixed_asset_depreciation_runs" DROP CONSTRAINT IF EXISTS "CHK_fixed_asset_depreciation_runs_totals"`);
    // A run that charged only tax months has nowhere to go back to: the earlier rule wants a posted total.
    await q.query(`DELETE FROM "fixed_asset_book_charges"`);
    await q.query(`DELETE FROM "fixed_asset_depreciation_runs" WHERE "total" = 0`);
    await q.query(`
      ALTER TABLE "fixed_asset_depreciation_runs" ADD CONSTRAINT "CHK_fixed_asset_depreciation_runs_totals"
        CHECK ("asset_count" > 0 AND "charge_count" >= "asset_count" AND "total" > 0)`);
    await q.query(`ALTER TABLE "fixed_asset_depreciation_runs" DROP COLUMN IF EXISTS "tax_total"`);
    await q.query(`ALTER TABLE "fixed_asset_depreciation_runs" DROP COLUMN IF EXISTS "tax_charge_count"`);

    await q.query(`DROP TABLE IF EXISTS "fixed_asset_book_charges"`);
    await q.query(`DROP TABLE IF EXISTS "fixed_asset_books"`);

    await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "CHK_fixed_asset_declining_rate"`);
    await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "CHK_fixed_asset_method"`);
    await q.query(`UPDATE "fixed_asset" SET "depreciation_method" = 'DOUBLE_DECLINING_BALANCE' WHERE "depreciation_method" = 'DECLINING_BALANCE'`);
    await q.query(`ALTER TABLE "fixed_asset" ADD CONSTRAINT "CHK_fixed_asset_method" CHECK ("depreciation_method" IN ('STRAIGHT_LINE', 'DOUBLE_DECLINING_BALANCE', 'SUM_OF_YEARS_DIGITS'))`);
    await q.query(`ALTER TABLE "fixed_asset" DROP COLUMN IF EXISTS "declining_annual_rate"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_fixed_asset_category"`);
    await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "FK_fixed_asset_category"`);
    await q.query(`ALTER TABLE "fixed_asset" DROP COLUMN IF EXISTS "category_id"`);
    await q.query(`DROP TABLE IF EXISTS "fixed_asset_categories"`);
  }
}
