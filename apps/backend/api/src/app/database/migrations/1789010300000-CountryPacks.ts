import { MigrationInterface, QueryRunner } from 'typeorm';
import es from '../../i18n/messages/es.json';
import en from '../../i18n/messages/en.json';
import pt from '../../i18n/messages/pt.json';
import { SeedLanguage, seedTenantDefaults } from '../seeds/tenant-defaults';
import { DEFAULT_CUSTOMER_NAME_KEYS, countryPackFor } from '../../contracts/country-pack/country-pack';

/** The generated API catalogues, read directly: migrations run without the application's DI. */
const CATALOGUES: Record<SeedLanguage, Record<string, string>> = { es, en, pt };
const LANGUAGES: readonly SeedLanguage[] = ['es', 'en', 'pt'];
const translate = (key: string, language: SeedLanguage): string =>
  CATALOGUES[language][key] ?? CATALOGUES.es[key] ?? key;

const tenantPredicate = `"organization_id" = (NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

/**
 * Country packs (QA C-06): what a company outside the Dominican Republic needed and did not have.
 *
 * - `payment_methods`: the company's own payment methods, with the authority's code beside its own
 *   where the market has a catalogue. Seeded per market — the DGII's seven fixed codes for a
 *   Dominican company, ACH/wire/check/card/Zelle/cash for a US one, SAT `c_FormaPago`, DIAN, PIX…
 * - `payroll_company_parameters`: the payroll figures a company keeps, effective-dated — FICA,
 *   Medicare and FUTA for a US company as editable statutory defaults, its state withholding table
 *   and unemployment rate as placeholders to fill in.
 * - `invoices.payment_method_code`: which of those methods a sale was paid with («ZELLE»), beside
 *   the settlement kind the e-invoicing adapters map (`payment_method`).
 * - `organizations.books_language`, written for every tenant that never had it: it was documented as
 *   set from the country at provisioning and never was, so every company — the US ones included —
 *   kept Spanish books and got a «Consumidor final».
 * - The default customer renamed to its market's name («Walk-in customer», «Público en general»)
 *   where it still carries a seeded name and no tax id — a customer someone renamed or identified is
 *   theirs and is left alone.
 *
 * Every tenant then runs the same seed provisioning runs (`seedTenantDefaults`), with
 * `app.current_organization` set so it reads and writes through row-level security.
 */
export class CountryPacks1789010300000 implements MigrationInterface {
  name = 'CountryPacks1789010300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "payment_methods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "code" character varying(20) NOT NULL,
        "name" character varying(120) NOT NULL,
        "kind" character varying(20) NOT NULL,
        "fiscal_code" character varying(10),
        "is_system" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 100,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_methods" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payment_methods_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_payment_methods_kind" CHECK ("kind" IN
          ('CASH','CHECK','CREDIT_CARD','DEBIT_CARD','CREDIT','BANK_TRANSFER','GIFT_CARD','SWAP','OTHER'))
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_methods_org_code" ON "payment_methods" ("organization_id", "code")`,
    );
    await this.isolate(q, 'payment_methods');

    await q.query(`
      CREATE TABLE IF NOT EXISTS "payroll_company_parameters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "country_code" character varying(2) NOT NULL,
        "code" character varying(40) NOT NULL,
        "name" character varying(160) NOT NULL,
        "kind" character varying(16) NOT NULL,
        "jurisdiction" character varying(8) NOT NULL DEFAULT '',
        "employee_rate" numeric(9,6),
        "employer_rate" numeric(9,6),
        "wage_base" numeric(14,2),
        "threshold" numeric(14,2),
        "credit_rate" numeric(9,6),
        "amount" numeric(14,2),
        "brackets" jsonb,
        "currency_code" character varying(3) NOT NULL,
        "effective_from" date NOT NULL,
        "effective_to" date,
        "source" character varying(20) NOT NULL DEFAULT 'COMPANY',
        "legal_basis" character varying(200),
        "requires_input" boolean NOT NULL DEFAULT false,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payroll_company_parameters" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payroll_company_parameters_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_payroll_company_parameters_kind" CHECK ("kind" IN ('CONTRIBUTION','TABLE','AMOUNT')),
        CONSTRAINT "CHK_payroll_company_parameters_window"
          CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_payroll_company_parameters_lookup"
         ON "payroll_company_parameters" ("organization_id", "code", "effective_from")`,
    );
    // One figure per parameter, jurisdiction and date: recording the same date again corrects it.
    // A national parameter's jurisdiction is '' rather than NULL, so the index can tell two of them
    // apart without an expression (NULLs never collide in a unique index).
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payroll_company_parameters_version"
         ON "payroll_company_parameters" ("organization_id", "code", "jurisdiction", "effective_from")`,
    );
    await this.isolate(q, 'payroll_company_parameters');

    // The application role is unprivileged and sees nothing it is not granted.
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_methods" TO virtex_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_company_parameters" TO virtex_app;
        END IF;
      END
      $$;
    `);

    await q.query(`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_method_code" character varying(20)`);

    const tenants: Array<{
      id: string;
      country: string | null;
      books_language: string | null;
      base_currency: string | null;
      default_cash_id: string | null;
    }> = await q.query(
      `SELECT o."id", o."country", o."books_language", s."base_currency", s."default_cash_id"
         FROM "organizations" o
         LEFT JOIN "organization_settings" s ON s."organization_id" = o."id"`,
    );

    // Every name a default customer was ever seeded under, in every language.
    const seededNames = DEFAULT_CUSTOMER_NAME_KEYS.flatMap((key) =>
      LANGUAGES.map((language) => translate(key, language).toLowerCase()),
    );

    for (const tenant of tenants) {
      const pack = countryPackFor(tenant.country);
      const booksLanguage = tenant.books_language ?? pack.booksLanguage;
      if (!tenant.books_language && booksLanguage) {
        await q.query(`UPDATE "organizations" SET "books_language" = $2 WHERE "id" = $1`, [tenant.id, booksLanguage]);
      }

      await q.query(`SELECT set_config('app.current_organization', $1, true)`, [tenant.id]);

      const language = (booksLanguage ?? 'es') as SeedLanguage;
      await q.query(
        `UPDATE "customers" SET "companyName" = $2
          WHERE "organization_id" = $1 AND "is_final_consumer" AND "taxId" IS NULL
            AND lower("companyName") = ANY($3) AND "companyName" <> $2`,
        [tenant.id, translate(pack.defaultCustomer.nameKey, language), seededNames],
      );

      await seedTenantDefaults(
        q,
        {
          organizationId: tenant.id,
          country: tenant.country,
          booksLanguage,
          baseCurrency: tenant.base_currency ?? 'USD',
          cashAccountId: tenant.default_cash_id,
        },
        translate,
      );
    }
    await q.query(`SELECT set_config('app.current_organization', '', true)`);
  }

  /**
   * The schema goes back exactly. The books language and the renamed default customer stay: both
   * are corrections, and undoing them would hand the US companies their Spanish books back.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "payment_method_code"`);
    await q.query(`DROP TABLE IF EXISTS "payroll_company_parameters"`);
    await q.query(`DROP TABLE IF EXISTS "payment_methods"`);
  }

  private async isolate(q: QueryRunner, table: string): Promise<void> {
    await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    await q.query(
      `CREATE POLICY tenant_isolation ON "${table}" USING (${tenantPredicate}) WITH CHECK (${tenantPredicate})`,
    );
  }
}
