
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

/**
 * Payroll concepts for the Dominican engine — the only jurisdiction with a payroll strategy.
 *
 * The statutory rows (AFP, SFS, ISR) carry no amount: the engine computes them from the versioned
 * parameters. They exist so the payslip names them and an account can be attached. The others are
 * the lines a Dominican payroll uses in its first month: overtime at the Labour Code's premiums,
 * the night premium, a bonus, a commission, a loan repayment and an advance.
 */
const DO_PAYROLL_CONCEPTS: ReadonlyArray<{
  code: string;
  nameKey: string;
  type: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';
  calculation: 'FIXED' | 'PERCENTAGE' | 'HOURLY' | 'STATUTORY';
  rate: number | null;
  taxable: boolean;
  contributesToTss: boolean;
  sortOrder: number;
  isSystem: boolean;
}> = [
  { code: 'HE35', nameKey: 'payroll.concepts.seed.overtime_35', type: 'EARNING', calculation: 'HOURLY', rate: 1.35, taxable: true, contributesToTss: true, sortOrder: 20, isSystem: false },
  { code: 'HE100', nameKey: 'payroll.concepts.seed.overtime_100', type: 'EARNING', calculation: 'HOURLY', rate: 2, taxable: true, contributesToTss: true, sortOrder: 21, isSystem: false },
  { code: 'NOCT', nameKey: 'payroll.concepts.seed.night_premium', type: 'EARNING', calculation: 'HOURLY', rate: 0.15, taxable: true, contributesToTss: true, sortOrder: 22, isSystem: false },
  { code: 'BONO', nameKey: 'payroll.concepts.seed.bonus', type: 'EARNING', calculation: 'FIXED', rate: null, taxable: true, contributesToTss: false, sortOrder: 30, isSystem: false },
  { code: 'COMISION', nameKey: 'payroll.concepts.seed.commission', type: 'EARNING', calculation: 'FIXED', rate: null, taxable: true, contributesToTss: true, sortOrder: 31, isSystem: false },
  { code: 'AFP', nameKey: 'payroll.concepts.seed.afp', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 200, isSystem: true },
  { code: 'SFS', nameKey: 'payroll.concepts.seed.sfs', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 201, isSystem: true },
  { code: 'ISR', nameKey: 'payroll.concepts.seed.isr', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 210, isSystem: true },
  { code: 'PRESTAMO', nameKey: 'payroll.concepts.seed.loan_repayment', type: 'DEDUCTION', calculation: 'FIXED', rate: null, taxable: false, contributesToTss: false, sortOrder: 300, isSystem: false },
  { code: 'ANTICIPO', nameKey: 'payroll.concepts.seed.salary_advance', type: 'DEDUCTION', calculation: 'FIXED', rate: null, taxable: false, contributesToTss: false, sortOrder: 301, isSystem: false },
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

/** Seed one tenant's working defaults. Safe to run any number of times. */
export async function seedTenantDefaults(
  runner: SqlRunner,
  context: TenantDefaultsContext,
  translate: Translate,
): Promise<void> {
  const language = seedLanguage(context.booksLanguage);
  const t = (key: string) => translate(key, language);
  const { organizationId } = context;
  const country = context.country?.toUpperCase() ?? null;

  // «Consumidor final»: the buyer of every sale that names nobody. In the Dominican Republic it is
  // also what a consumer invoice (E32) is issued to below the identification threshold. One per
  // company, enforced by the partial unique index on `is_final_consumer`.
  //
  // A customer of that name with no tax id is adopted first rather than duplicated: a company that
  // already created its own «Consumidor final» by hand, or a database migrated down and up again,
  // keeps one, with its history.
  const finalConsumerName = t('ledger.provisioning.final_consumer');
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

  if (country === 'DO') {
    for (const concept of DO_PAYROLL_CONCEPTS) {
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
}
