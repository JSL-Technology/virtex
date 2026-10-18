import { CountryPack, countryPackFor } from '../../contracts/country-pack/country-pack';

/**
 * The working data a company starts with, beyond its books.
 *
 * A new tenant had a chart of accounts, journals and a warehouse, and nothing to sell to, nothing to
 * sell, nowhere to take cash and no payroll lines: the first invoice needed a customer created by
 * hand, the first product a category, the first cash sale a till, the first payroll run its
 * concepts. Every competitor ships these; a company that has to build them before it can work is a
 * company that has not started.
 *
 * Written against a bare `query(sql, params)` so the SAME seed runs from provisioning (inside the
 * signup transaction) and from the migration that backfills tenants created before it existed —
 * two copies of a seed are two seeds that drift. Every statement is idempotent: re-running it on a
 * tenant that already has the row (or that renamed it) changes nothing.
 */
export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

/** The translations a seed needs, so this module does not depend on the i18n service's wiring. */
export type Translate = (key: string, language: SeedLanguage) => string;

/**
 * The languages seeded names are written in. Kept local, with no path aliases, because the
 * backfill migration imports this file and migrations run without the application's module
 * resolution.
 */
export type SeedLanguage = 'es' | 'en' | 'pt';

function seedLanguage(value: string | null | undefined): SeedLanguage {
  const base = (value ?? '').toLowerCase().split(/[-_]/)[0];
  return base === 'en' || base === 'pt' ? base : 'es';
}

export interface TenantDefaultsContext {
  organizationId: string;
  /** ISO 3166-1 alpha-2 of the company, upper case. */
  country: string | null;
  /** The statutory language of the books: what seeded names are written in. */
  booksLanguage: string | null;
  baseCurrency: string;
  /** The ledger account cash sales post to, when the chart declares one. */
  cashAccountId: string | null;
}

/**
 * Units of measure, keyed by the code products and documents carry (`UND` is the product default).
 * Platform reference data, shared by every tenant.
 */
export const UNITS_OF_MEASURE: ReadonlyArray<{ symbol: string; category: string; nameKey: string }> = [
  { symbol: 'UND', category: 'Units', nameKey: 'uom.unit' },
  { symbol: 'PAR', category: 'Units', nameKey: 'uom.pair' },
  { symbol: 'DOC', category: 'Units', nameKey: 'uom.dozen' },
  { symbol: 'CJ', category: 'Units', nameKey: 'uom.box' },
  { symbol: 'PAQ', category: 'Units', nameKey: 'uom.pack' },
  { symbol: 'JGO', category: 'Units', nameKey: 'uom.set' },
  { symbol: 'SRV', category: 'Units', nameKey: 'uom.service' },
  { symbol: 'G', category: 'Weight', nameKey: 'uom.gram' },
  { symbol: 'KG', category: 'Weight', nameKey: 'uom.kilogram' },
  { symbol: 'LB', category: 'Weight', nameKey: 'uom.pound' },
  { symbol: 'OZ', category: 'Weight', nameKey: 'uom.ounce' },
  { symbol: 'QQ', category: 'Weight', nameKey: 'uom.hundredweight' },
  { symbol: 'TON', category: 'Weight', nameKey: 'uom.tonne' },
  { symbol: 'CM', category: 'Length', nameKey: 'uom.centimetre' },
  { symbol: 'M', category: 'Length', nameKey: 'uom.metre' },
  { symbol: 'IN', category: 'Length', nameKey: 'uom.inch' },
  { symbol: 'FT', category: 'Length', nameKey: 'uom.foot' },
  { symbol: 'M2', category: 'Area', nameKey: 'uom.square_metre' },
  { symbol: 'FT2', category: 'Area', nameKey: 'uom.square_foot' },
  { symbol: 'M3', category: 'Volume', nameKey: 'uom.cubic_metre' },
  { symbol: 'ML', category: 'Volume', nameKey: 'uom.millilitre' },
  { symbol: 'L', category: 'Volume', nameKey: 'uom.litre' },
  { symbol: 'GAL', category: 'Volume', nameKey: 'uom.gallon' },
  { symbol: 'HR', category: 'Time', nameKey: 'uom.hour' },
  { symbol: 'DIA', category: 'Time', nameKey: 'uom.day' },
  { symbol: 'MES', category: 'Time', nameKey: 'uom.month' },
];

/** The global unit-of-measure catalogue. Idempotent on the symbol. */
export async function seedUnitsOfMeasure(runner: SqlRunner): Promise<void> {
  for (const unit of UNITS_OF_MEASURE) {
    await runner.query(
      `INSERT INTO "unit_of_measure" ("symbol", "category", "nameKey")
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [unit.symbol, unit.category, unit.nameKey],
    );
  }
}

/**
 * Seed one tenant's defaults: its working data, its payment methods and its payroll parameters.
 * Safe to run any number of times. What provisioning runs.
 */
export async function seedTenantDefaults(
  runner: SqlRunner,
  context: TenantDefaultsContext,
  translate: Translate,
): Promise<void> {
  await seedTenantWorkingDefaults(runner, context, translate);
  const t = (key: string) => translate(key, seedLanguage(context.booksLanguage));
  const pack = countryPackFor(context.country);
  await seedPaymentMethods(runner, context.organizationId, pack, t);
  await seedCompanyPayrollParameters(runner, context.organizationId, pack, context.baseCurrency, t);
}

/**
 * The working data alone: the default customer, a category, the till and the payroll concepts.
 *
 * Split from {@link seedTenantDefaults} because `TenantWorkingDefaults1789009800000` backfills
 * exactly these, and on a fresh database it runs before the migration that creates the payment
 * method and company payroll parameter tables (`CountryPacks1789010300000`), which backfills those.
 */
export async function seedTenantWorkingDefaults(
  runner: SqlRunner,
  context: TenantDefaultsContext,
  translate: Translate,
): Promise<void> {
  const language = seedLanguage(context.booksLanguage);
  const t = (key: string) => translate(key, language);
  const { organizationId } = context;
  const country = context.country?.toUpperCase() ?? null;

  // The buyer of every sale that names nobody, under the name its market gives it: «Consumidor
  // final» in the Dominican Republic — where it is also what a consumer invoice (E32) is issued to
  // below the identification threshold —, «Público en general» in Mexico, the SAT's own term, and a
  // «Walk-in customer» in the United States (QA C-06: an English-speaking US company was handed
  // «Consumidor final»). One per company, enforced by the partial unique index on
  // `is_final_consumer`.
  //
  // A customer of that name with no tax id is adopted first rather than duplicated: a company that
  // already created its own by hand, or a database migrated down and up again, keeps one, with its
  // history.
  const pack = countryPackFor(country);
  const finalConsumerName = t(pack.defaultCustomer.nameKey);
  await runner.query(
    `UPDATE "customers" SET "is_final_consumer" = true
      WHERE "id" = (
        SELECT "id" FROM "customers"
         WHERE "organization_id" = $1 AND lower("companyName") = lower($2) AND "taxId" IS NULL
         ORDER BY "created_at" LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM "customers" WHERE "organization_id" = $1 AND "is_final_consumer")`,
    [organizationId, finalConsumerName],
  );
  await runner.query(
    `INSERT INTO "customers" ("organization_id", "companyName", "country", "status", "is_final_consumer", "payment_term_days")
     SELECT $1, $2, $3, 'ACTIVE', true, 0
      WHERE NOT EXISTS (SELECT 1 FROM "customers" WHERE "organization_id" = $1 AND "is_final_consumer")`,
    [organizationId, finalConsumerName, country],
  );

  // A category for products created before anyone has thought about categories.
  await runner.query(
    `INSERT INTO "product_categories" ("organization_id", "name", "code", "sort_order")
     SELECT $1, $2, 'GENERAL', 0
      WHERE NOT EXISTS (SELECT 1 FROM "product_categories" WHERE "organization_id" = $1)`,
    [organizationId, t('ledger.provisioning.default_category')],
  );

  // The till: a CASH account on the chart's cash account, so a cash sale or receipt has somewhere
  // to land on day one. Skipped when the chart declares no cash account.
  if (context.cashAccountId) {
    await runner.query(
      `INSERT INTO "bank_accounts" ("organization_id", "name", "account_type", "currency_code", "gl_account_id")
       SELECT $1, $2, 'CASH', $3, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM "bank_accounts" WHERE "organization_id" = $1 AND "account_type" = 'CASH'
        )`,
      [organizationId, t('ledger.provisioning.cash_account'), context.baseCurrency, context.cashAccountId],
    );
  }

  // The payroll lines the market's payroll uses in its first month (the Dominican engine's AFP, SFS
  // and ISR; the US FICA, Medicare and income-tax lines), from its pack. A market whose pack names
  // none gets none: an empty list is honest, a borrowed one is the defect.
  for (const concept of pack.payroll.concepts) {
    await runner.query(
      `INSERT INTO "payroll_concepts"
         ("organization_id", "code", "name", "type", "calculation", "rate", "taxable",
          "contributes_to_tss", "sort_order", "active", "is_system")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)
       ON CONFLICT DO NOTHING`,
      [
        organizationId,
        concept.code,
        t(concept.nameKey),
        concept.type,
        concept.calculation,
        concept.rate,
        concept.taxable,
        concept.contributesToTss,
        concept.sortOrder,
        concept.isSystem,
      ],
    );
  }
}

/**
 * The payment methods the market starts with (QA C-06).
 *
 * The DGII's seven codes for a Dominican company, marked `is_system` because the authority owns
 * them; ACH, wire, check, card, Zelle and cash for a US company; SAT's `c_FormaPago`, DIAN's «medios
 * de pago», PIX and boleto where those are how the market pays. Idempotent on the code, so a company
 * that already has a method of that code — seeded or its own — keeps it as it is.
 */
export async function seedPaymentMethods(
  runner: SqlRunner,
  organizationId: string,
  pack: CountryPack,
  t: (key: string) => string,
): Promise<void> {
  const fixed = pack.paymentMethods.catalogue === 'AUTHORITY_FIXED';
  for (const [index, method] of pack.paymentMethods.defaults.entries()) {
    await runner.query(
      `INSERT INTO "payment_methods"
         ("organization_id", "code", "name", "kind", "fiscal_code", "is_system", "is_active", "sort_order")
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       ON CONFLICT ("organization_id", "code") DO NOTHING`,
      [organizationId, method.code, t(method.nameKey), method.kind, method.fiscalCode, fixed, (index + 1) * 10],
    );
  }
}

/**
 * The payroll figures a company keeps for itself, as editable statutory defaults (QA C-06).
 *
 * Only for a market whose pack says the company keeps them (`statutoryParameters: 'COMPANY'`); the
 * Dominican rates are the platform's and live in the global statutory tables. Idempotent on
 * (code, effective date): a company that already recorded a figure for that date keeps its own, and
 * next year's defaults are added beside this year's rather than over them.
 */
export async function seedCompanyPayrollParameters(
  runner: SqlRunner,
  organizationId: string,
  pack: CountryPack,
  currency: string,
  t: (key: string) => string,
): Promise<void> {
  if (pack.payroll.statutoryParameters !== 'COMPANY') return;
  for (const parameter of pack.payroll.parameters) {
    await runner.query(
      `INSERT INTO "payroll_company_parameters"
         ("organization_id", "country_code", "code", "name", "kind", "employee_rate", "employer_rate",
          "wage_base", "threshold", "credit_rate", "amount", "currency_code", "effective_from",
          "source", "legal_basis", "requires_input", "active")
       SELECT $1::uuid, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::numeric, $7::numeric,
              $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::varchar, $13::date,
              'STATUTORY_DEFAULT', $14::varchar, $15::boolean, true
        WHERE NOT EXISTS (
          SELECT 1 FROM "payroll_company_parameters"
           WHERE "organization_id" = $1::uuid AND "code" = $3::varchar AND "effective_from" = $13::date)`,
      [
        organizationId,
        pack.countryCode,
        parameter.code,
        t(parameter.nameKey),
        parameter.kind,
        parameter.employeeRate ?? null,
        parameter.employerRate ?? null,
        parameter.wageBase ?? null,
        parameter.threshold ?? null,
        parameter.creditRate ?? null,
        parameter.amount ?? null,
        currency,
        parameter.effectiveFrom,
        parameter.legalBasis,
        parameter.requiresInput === true,
      ],
    );
  }
}
