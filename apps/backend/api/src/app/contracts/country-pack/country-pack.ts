import type {
  CountryPackExamples,
  CountryPackReportLink,
  CountryTaxModel,
  FiscalReturnGenerator,
  PaymentMethodCatalogue,
} from '@virteex/shared/types';

/**
 * The country pack: everything a market declares about itself, in one place (QA C-06).
 *
 * ## The failure this replaces
 *
 * A company registered in the United States received the Dominican product. Not through one bug but
 * through a dozen independent defaults, each of them written for the first market and never told
 * about the others: the payment methods were the DGII's seven codes, «fixed by the DGII»; the taxes
 * screen was empty and the invoice's tax column a free number; the payroll parameters were empty
 * with no way to add one; the fiscal returns page described the DGII formats; the default customer
 * was «Consumidor final»; the invoice asked about «Withholding at source».
 *
 * Each of those is a question with a per-market answer — does this market withhold at source? who
 * owns the payment-method list? which payroll rates does a company start from? — and the answer was
 * either hard-coded for the Dominican Republic or not asked at all. A pack is the list of those
 * questions, answered once per market. Screens and services read the answer; none of them names a
 * country.
 *
 * ## Why it lives in `contracts/`
 *
 * It is read by provisioning (the seed that runs inside the signup transaction and from backfill
 * migrations), by sales, purchasing, treasury and payroll, and by the localization endpoint that
 * serves its public half to the browser. `contracts/` is platform: anyone may depend on it and it
 * depends on no business module, which is what lets the provisioning seed in `database/` read it
 * without a forbidden edge. For the same reason it does not import the country profiles: the pack
 * states capabilities and seeds, and `localization` adds the profile facts (authority, divisions)
 * when it publishes the pack. `localization/fiscal/country-pack.spec.ts` checks the two agree on
 * which markets exist.
 *
 * ## Adding a market
 *
 * See `docs/architecture/COUNTRY_PACK.md`. In short: add its profile, tax scheme and validators in
 * `localization/fiscal`, then its entry in {@link COUNTRY_PACKS} answering every field below. The
 * spec refuses a market with a profile and no pack, so the second step cannot be forgotten.
 */

/**
 * How a payment method settles, in the vocabulary the e-invoicing adapters map to their authority's
 * code (`invoices.payment_method`). Mirrors `PaymentMethod` in the invoice entity; kept as a string
 * union here so platform code does not import a sales entity.
 */
export type PaymentSettlementKind =
  | 'CASH'
  | 'CHECK'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'CREDIT'
  | 'BANK_TRANSFER'
  | 'GIFT_CARD'
  | 'SWAP'
  | 'OTHER';

export const PAYMENT_SETTLEMENT_KINDS: readonly PaymentSettlementKind[] = [
  'CASH',
  'CHECK',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'CREDIT',
  'BANK_TRANSFER',
  'GIFT_CARD',
  'SWAP',
  'OTHER',
];

/** A payment method a company starts with. */
export interface PaymentMethodSeed {
  /** The code documents record. Unique per company; the authority's own where it has one. */
  code: string;
  /** Catalogue key of its name, resolved into the books language when seeded. */
  nameKey: string;
  kind: PaymentSettlementKind;
  /**
   * The code the authority's documents carry for it: DGII 606 «Forma de pago», SAT `c_FormaPago`,
   * DIAN «Medios de pago», SEFAZ `tPag`. Null where the market has no such catalogue (the United
   * States) or the method has no code in it.
   */
  fiscalCode: string | null;
}

/** What a company payroll parameter is. */
export type PayrollParameterKind =
  /** A rate on wages, split employee/employer, optionally capped by an annual wage base. */
  | 'CONTRIBUTION'
  /** A withholding table (brackets) the company enters from the authority's publication. */
  | 'TABLE'
  /** A single amount (a minimum wage, an allowance). */
  | 'AMOUNT';

/**
 * A payroll parameter a company starts with, as an editable statutory default.
 *
 * Every figure carries the date it takes effect, because statutory rates move every year — the US
 * Social Security wage base is re-indexed each October for the following January — and a payroll
 * recomputed for a past period must keep the figure in force then. Updating one is recording the
 * new figure from its new date; the old one stays.
 *
 * A seed with no figures (`requiresInput`) is a parameter the market has but whose value depends on
 * the company: its state's income-tax withholding table, its state unemployment rate. Seeding it
 * empty puts it on the screen as something to fill in, instead of leaving the company to discover
 * that it is missing.
 */
export interface PayrollParameterSeed {
  code: string;
  nameKey: string;
  kind: PayrollParameterKind;
  employeeRate?: number;
  employerRate?: number;
  /** Annual wage base the rate stops applying at. */
  wageBase?: number;
  /** Annual wages above which the rate starts applying. */
  threshold?: number;
  /** Credit against the rate (FUTA's credit for state unemployment taxes paid). */
  creditRate?: number;
  amount?: number;
  effectiveFrom: string;
  /** The instrument that sets the figure, so checking it is a lookup rather than research. */
  legalBasis: string;
  /** The company must enter the values; nothing national can be seeded. */
  requiresInput?: boolean;
}

/** A payroll concept a company starts with. */
export interface PayrollConceptSeed {
  code: string;
  nameKey: string;
  type: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';
  calculation: 'FIXED' | 'PERCENTAGE' | 'HOURLY' | 'STATUTORY';
  rate: number | null;
  taxable: boolean;
  /** Part of the social-security base (TSS in DR, FICA wages in the US). */
  contributesToTss: boolean;
  sortOrder: number;
  isSystem: boolean;
}

export interface CountryPack {
  countryCode: string;

  /**
   * The statutory language of the market's books: what a new company's ledger, journals and seeded
   * names are written in. Mirrors the language of the market's profile locale
   * (`languageOfCountry`); the localization spec checks they agree. Null for an unknown market.
   */
  booksLanguage: 'es' | 'en' | 'pt' | null;

  documents: {
    fiscalNumbering: boolean;
    supplierFiscalNumber: boolean;
    supplierDocumentNumberKey: string;
    purchaseClassification: boolean;
  };

  withholding: { applies: boolean };

  taxes: { model: CountryTaxModel; nameKey: string };

  paymentMethods: {
    catalogue: PaymentMethodCatalogue;
    authority: string | null;
    defaults: readonly PaymentMethodSeed[];
  };

  payroll: {
    statutoryParameters: 'PLATFORM' | 'COMPANY';
    parameters: readonly PayrollParameterSeed[];
    concepts: readonly PayrollConceptSeed[];
  };

  /** The customer a sale names when it names nobody. */
  defaultCustomer: { nameKey: string };

  fiscalReturns: {
    generator: FiscalReturnGenerator | null;
    dueDay: number | null;
    prepareWith: readonly CountryPackReportLink[];
  };

  examples: CountryPackExamples;
}

// ── Shared building blocks ───────────────────────────────────────────────────────────────────

const pm = (
  code: string,
  nameKey: string,
  kind: PaymentSettlementKind,
  fiscalCode: string | null = null,
): PaymentMethodSeed => ({ code, nameKey, kind, fiscalCode });

/**
 * The methods a market without an authority catalogue of payment forms starts with. Codes are
 * mnemonic and stable; the names follow the books language.
 */
const GENERIC_PAYMENT_METHODS: readonly PaymentMethodSeed[] = [
  pm('CASH', 'ledger.provisioning.payment_methods.cash', 'CASH'),
  pm('TRANSFER', 'ledger.provisioning.payment_methods.bank_transfer', 'BANK_TRANSFER'),
  pm('CHECK', 'ledger.provisioning.payment_methods.check', 'CHECK'),
  pm('DEBIT_CARD', 'ledger.provisioning.payment_methods.debit_card', 'DEBIT_CARD'),
  pm('CREDIT_CARD', 'ledger.provisioning.payment_methods.credit_card', 'CREDIT_CARD'),
  pm('CREDIT', 'ledger.provisioning.payment_methods.on_account', 'CREDIT'),
];

/**
 * Where a market has no return generator, the reports its returns are prepared from. Sales and
 * purchase registers for the VAT/sales-tax return, the ledger for the tax accounts' balances, the
 * trial balance and income statement for the annual return.
 */
const report = (labelKey: string, route: string): CountryPackReportLink => ({ labelKey, route });

const PREPARE_WITH_LEDGERS: readonly CountryPackReportLink[] = [
  report('localization.country_pack.reports.sales_invoices', '/invoices'),
  report('localization.country_pack.reports.vendor_bills', '/accounts-payable'),
  report('localization.country_pack.reports.general_ledger', '/accounting/general-ledger'),
  report('localization.country_pack.reports.trial_balance', '/reports/financial-statements/trial-balance'),
  report('localization.country_pack.reports.income_statement', '/reports/financial-statements/income-statement'),
];

/** United States: sales tax by state, payments to contractors for the 1099s, the annual statements. */
const PREPARE_WITH_US: readonly CountryPackReportLink[] = [
  report('localization.country_pack.reports.sales_invoices', '/invoices'),
  report('localization.country_pack.reports.general_ledger', '/accounting/general-ledger'),
  report('localization.country_pack.reports.supplier_payments', '/accounts-payable/payments'),
  report('localization.country_pack.reports.trial_balance', '/reports/financial-statements/trial-balance'),
  report('localization.country_pack.reports.income_statement', '/reports/financial-statements/income-statement'),
];

const LATAM_DOCUMENTS: CountryPack['documents'] = {
  fiscalNumbering: true,
  supplierFiscalNumber: false,
  supplierDocumentNumberKey: 'localization.country_pack.supplier_document.fiscal_number',
  purchaseClassification: false,
};

const VAT = { model: 'NATIONAL_RATES' as const, nameKey: 'localization.country_pack.tax_name.vat' };

const NO_PAYROLL_SEEDS: CountryPack['payroll'] = {
  statutoryParameters: 'COMPANY',
  parameters: [],
  concepts: [],
};

/**
 * A Latin American market whose particulars this product has not modelled beyond its tax scheme:
 * authority numbering, withholding, the national VAT, the generic payment methods, the honest «no
 * generator» returns page. Every field is still answered — the point is that nothing falls back to
 * another country's answer.
 */
function latamPack(
  countryCode: string,
  examples: CountryPackExamples,
  overrides: Partial<CountryPack> = {},
): CountryPack {
  return {
    countryCode,
    booksLanguage: 'es',
    documents: LATAM_DOCUMENTS,
    withholding: { applies: true },
    taxes: VAT,
    paymentMethods: { catalogue: 'EDITABLE', authority: null, defaults: GENERIC_PAYMENT_METHODS },
    payroll: NO_PAYROLL_SEEDS,
    defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
    fiscalReturns: { generator: null, dueDay: null, prepareWith: PREPARE_WITH_LEDGERS },
    examples,
    ...overrides,
  };
}

// ── Dominican Republic ───────────────────────────────────────────────────────────────────────

/**
 * Payroll concepts for the Dominican engine — the only jurisdiction with a payroll strategy.
 *
 * The statutory rows (AFP, SFS, ISR) carry no amount: the engine computes them from the versioned
 * parameters. They exist so the payslip names them and an account can be attached. The others are
 * the lines a Dominican payroll uses in its first month: overtime at the Labour Code's premiums,
 * the night premium, a bonus, a commission, a loan repayment and an advance.
 */
const DO_PAYROLL_CONCEPTS: readonly PayrollConceptSeed[] = [
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

/**
 * The DGII's 606 «Forma de pago» catalogue (Norma General 07-2018), 01 to 07. A Dominican company
 * cannot add an eighth: the purchase report carries these codes and nothing else, which is why the
 * catalogue is `AUTHORITY_FIXED` for this market and only this one.
 */
const DGII_PAYMENT_FORMS: readonly PaymentMethodSeed[] = [
  pm('01', 'ledger.provisioning.payment_methods.dgii_cash', 'CASH', '01'),
  pm('02', 'ledger.provisioning.payment_methods.dgii_check_transfer', 'BANK_TRANSFER', '02'),
  pm('03', 'ledger.provisioning.payment_methods.dgii_card', 'CREDIT_CARD', '03'),
  pm('04', 'ledger.provisioning.payment_methods.dgii_credit', 'CREDIT', '04'),
  pm('05', 'ledger.provisioning.payment_methods.dgii_barter', 'SWAP', '05'),
  pm('06', 'ledger.provisioning.payment_methods.dgii_credit_note', 'OTHER', '06'),
  pm('07', 'ledger.provisioning.payment_methods.dgii_mixed', 'OTHER', '07'),
];

// ── United States ────────────────────────────────────────────────────────────────────────────

/**
 * How a US business is paid. ACH is the default for business-to-business; Zelle is common for small
 * businesses; «On account» is the credit sale the due date turns an invoice into.
 */
const US_PAYMENT_METHODS: readonly PaymentMethodSeed[] = [
  pm('ACH', 'ledger.provisioning.payment_methods.ach', 'BANK_TRANSFER'),
  pm('WIRE', 'ledger.provisioning.payment_methods.wire', 'BANK_TRANSFER'),
  pm('CHECK', 'ledger.provisioning.payment_methods.check', 'CHECK'),
  pm('CARD', 'ledger.provisioning.payment_methods.card', 'CREDIT_CARD'),
  pm('ZELLE', 'ledger.provisioning.payment_methods.zelle', 'BANK_TRANSFER'),
  pm('CASH', 'ledger.provisioning.payment_methods.cash', 'CASH'),
  pm('ON_ACCOUNT', 'ledger.provisioning.payment_methods.on_account', 'CREDIT'),
];

/**
 * Federal payroll taxes for 2026, as editable statutory defaults.
 *
 * - Social Security (OASDI): 6.2 % employee and 6.2 % employer, up to the contribution and benefit
 *   base the SSA announced for 2026 ($184,500).
 * - Medicare (HI): 1.45 % each, no wage base.
 * - Additional Medicare: 0.9 % withheld from the employee only, on wages above $200,000 in the
 *   calendar year — the employer withholds from that threshold regardless of filing status.
 * - FUTA: 6.0 % of the first $7,000 of each employee's wages, reduced by up to 5.4 % of credit for
 *   state unemployment tax paid on time; 0.6 % net in a state that is not a credit-reduction state.
 *
 * Federal and state income-tax withholding are not rates but tables (IRS Publication 15-T; each
 * state's own), and state unemployment is a rate the state assigns to each employer; they are seeded
 * empty for the company to enter.
 */
const US_PAYROLL_PARAMETERS: readonly PayrollParameterSeed[] = [
  {
    code: 'FICA_SOCIAL_SECURITY', nameKey: 'payroll.company_parameters.seed.fica_social_security',
    kind: 'CONTRIBUTION', employeeRate: 0.062, employerRate: 0.062, wageBase: 184_500,
    effectiveFrom: '2026-01-01', legalBasis: 'IRC §3101(a), §3111(a); SSA 2026 contribution and benefit base',
  },
  {
    code: 'FICA_MEDICARE', nameKey: 'payroll.company_parameters.seed.fica_medicare',
    kind: 'CONTRIBUTION', employeeRate: 0.0145, employerRate: 0.0145,
    effectiveFrom: '2026-01-01', legalBasis: 'IRC §3101(b)(1), §3111(b)',
  },
  {
    code: 'FICA_MEDICARE_ADDITIONAL', nameKey: 'payroll.company_parameters.seed.fica_medicare_additional',
    kind: 'CONTRIBUTION', employeeRate: 0.009, employerRate: 0, threshold: 200_000,
    effectiveFrom: '2026-01-01', legalBasis: 'IRC §3101(b)(2), §3102(f)',
  },
  {
    code: 'FUTA', nameKey: 'payroll.company_parameters.seed.futa',
    kind: 'CONTRIBUTION', employeeRate: 0, employerRate: 0.06, wageBase: 7_000, creditRate: 0.054,
    effectiveFrom: '2026-01-01', legalBasis: 'IRC §3301, §3302, §3306(b)(1)',
  },
  {
    code: 'FEDERAL_INCOME_TAX_WITHHOLDING', nameKey: 'payroll.company_parameters.seed.federal_income_tax_withholding',
    kind: 'TABLE', effectiveFrom: '2026-01-01', legalBasis: 'IRS Publication 15-T', requiresInput: true,
  },
  {
    code: 'STATE_INCOME_TAX_WITHHOLDING', nameKey: 'payroll.company_parameters.seed.state_income_tax_withholding',
    kind: 'TABLE', effectiveFrom: '2026-01-01', legalBasis: 'State withholding tables', requiresInput: true,
  },
  {
    code: 'STATE_UNEMPLOYMENT', nameKey: 'payroll.company_parameters.seed.state_unemployment',
    kind: 'CONTRIBUTION', effectiveFrom: '2026-01-01', legalBasis: 'State unemployment insurance (SUTA) rate notice',
    requiresInput: true,
  },
];

/**
 * The lines a US payroll uses in its first month. The statutory rows carry no amount — they name the
 * line and take an account; the figures come from the parameters above.
 */
const US_PAYROLL_CONCEPTS: readonly PayrollConceptSeed[] = [
  { code: 'OT', nameKey: 'payroll.concepts.seed.us_overtime', type: 'EARNING', calculation: 'HOURLY', rate: 1.5, taxable: true, contributesToTss: true, sortOrder: 20, isSystem: false },
  { code: 'BONUS', nameKey: 'payroll.concepts.seed.bonus', type: 'EARNING', calculation: 'FIXED', rate: null, taxable: true, contributesToTss: true, sortOrder: 30, isSystem: false },
  { code: 'COMMISSION', nameKey: 'payroll.concepts.seed.commission', type: 'EARNING', calculation: 'FIXED', rate: null, taxable: true, contributesToTss: true, sortOrder: 31, isSystem: false },
  { code: 'TIPS', nameKey: 'payroll.concepts.seed.us_tips', type: 'EARNING', calculation: 'FIXED', rate: null, taxable: true, contributesToTss: true, sortOrder: 32, isSystem: false },
  { code: 'SS', nameKey: 'payroll.concepts.seed.us_social_security', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 200, isSystem: true },
  { code: 'MEDICARE', nameKey: 'payroll.concepts.seed.us_medicare', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 201, isSystem: true },
  { code: 'FIT', nameKey: 'payroll.concepts.seed.us_federal_income_tax', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 210, isSystem: true },
  { code: 'SIT', nameKey: 'payroll.concepts.seed.us_state_income_tax', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 211, isSystem: true },
  { code: '401K', nameKey: 'payroll.concepts.seed.us_401k', type: 'DEDUCTION', calculation: 'PERCENTAGE', rate: null, taxable: false, contributesToTss: false, sortOrder: 250, isSystem: false },
  { code: 'ER_SS', nameKey: 'payroll.concepts.seed.us_employer_social_security', type: 'EMPLOYER_CONTRIBUTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 400, isSystem: true },
  { code: 'ER_MEDICARE', nameKey: 'payroll.concepts.seed.us_employer_medicare', type: 'EMPLOYER_CONTRIBUTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 401, isSystem: true },
  { code: 'FUTA', nameKey: 'payroll.concepts.seed.us_futa', type: 'EMPLOYER_CONTRIBUTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 402, isSystem: true },
  { code: 'SUTA', nameKey: 'payroll.concepts.seed.us_suta', type: 'EMPLOYER_CONTRIBUTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToTss: false, sortOrder: 403, isSystem: true },
  { code: 'LOAN', nameKey: 'payroll.concepts.seed.loan_repayment', type: 'DEDUCTION', calculation: 'FIXED', rate: null, taxable: false, contributesToTss: false, sortOrder: 300, isSystem: false },
  { code: 'ADVANCE', nameKey: 'payroll.concepts.seed.salary_advance', type: 'DEDUCTION', calculation: 'FIXED', rate: null, taxable: false, contributesToTss: false, sortOrder: 301, isSystem: false },
];

// ── The packs ────────────────────────────────────────────────────────────────────────────────

export const COUNTRY_PACKS: Readonly<Record<string, CountryPack>> = {
  DO: {
    countryCode: 'DO',
    booksLanguage: 'es',
    documents: {
      fiscalNumbering: true,
      supplierFiscalNumber: true,
      supplierDocumentNumberKey: 'localization.country_pack.supplier_document.ncf',
      purchaseClassification: true,
    },
    withholding: { applies: true },
    taxes: { model: 'NATIONAL_RATES', nameKey: 'localization.country_pack.tax_name.itbis' },
    paymentMethods: { catalogue: 'AUTHORITY_FIXED', authority: 'DGII', defaults: DGII_PAYMENT_FORMS },
    payroll: { statutoryParameters: 'PLATFORM', parameters: [], concepts: DO_PAYROLL_CONCEPTS },
    defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
    fiscalReturns: { generator: 'DGII', dueDay: 15, prepareWith: [] },
    examples: { city: 'Santo Domingo', postalCode: '10101', phone: '809 555 0123' },
  },

  US: {
    countryCode: 'US',
    booksLanguage: 'en',
    documents: {
      // A US sales invoice carries no authority number and no stamp: it is numbered internally.
      fiscalNumbering: false,
      supplierFiscalNumber: false,
      supplierDocumentNumberKey: 'localization.country_pack.supplier_document.invoice_number',
      purchaseClassification: false,
    },
    // Backup and non-resident withholding are payment-level obligations reported on Forms 1099 and
    // 1042-S, never on the invoice; there is no buyer-side withholding agent.
    withholding: { applies: false },
    taxes: { model: 'BY_JURISDICTION', nameKey: 'localization.country_pack.tax_name.sales_tax' },
    paymentMethods: { catalogue: 'EDITABLE', authority: null, defaults: US_PAYMENT_METHODS },
    payroll: { statutoryParameters: 'COMPANY', parameters: US_PAYROLL_PARAMETERS, concepts: US_PAYROLL_CONCEPTS },
    defaultCustomer: { nameKey: 'ledger.provisioning.walk_in_customer' },
    fiscalReturns: { generator: null, dueDay: null, prepareWith: PREPARE_WITH_US },
    examples: { city: 'Austin', postalCode: '78701', phone: '(512) 555-0123' },
  },

  MX: latamPack('MX', { city: 'Monterrey', postalCode: '64000', phone: '81 5555 0123' }, {
    documents: { ...LATAM_DOCUMENTS, supplierDocumentNumberKey: 'localization.country_pack.supplier_document.cfdi_uuid' },
    // SAT `c_FormaPago`, which every CFDI 4.0 carries.
    paymentMethods: {
      catalogue: 'EDITABLE',
      authority: 'SAT',
      defaults: [
        pm('01', 'ledger.provisioning.payment_methods.cash', 'CASH', '01'),
        pm('02', 'ledger.provisioning.payment_methods.check', 'CHECK', '02'),
        pm('03', 'ledger.provisioning.payment_methods.bank_transfer', 'BANK_TRANSFER', '03'),
        pm('04', 'ledger.provisioning.payment_methods.credit_card', 'CREDIT_CARD', '04'),
        pm('28', 'ledger.provisioning.payment_methods.debit_card', 'DEBIT_CARD', '28'),
        pm('99', 'ledger.provisioning.payment_methods.to_be_defined', 'CREDIT', '99'),
      ],
    },
    // «Público en general» is the SAT's own name for the anonymous buyer (RFC XAXX010101000).
    defaultCustomer: { nameKey: 'ledger.provisioning.general_public' },
    fiscalReturns: { generator: 'SAT', dueDay: null, prepareWith: [] },
  }),

  CO: latamPack('CO', { city: 'Bogotá', postalCode: '110111', phone: '601 555 0123' }, {
    documents: { ...LATAM_DOCUMENTS, supplierDocumentNumberKey: 'localization.country_pack.supplier_document.cufe' },
    // DIAN «Medios de pago» (Anexo técnico de factura electrónica, tabla 13.3.4.2).
    paymentMethods: {
      catalogue: 'EDITABLE',
      authority: 'DIAN',
      defaults: [
        pm('10', 'ledger.provisioning.payment_methods.cash', 'CASH', '10'),
        pm('47', 'ledger.provisioning.payment_methods.bank_transfer', 'BANK_TRANSFER', '47'),
        pm('20', 'ledger.provisioning.payment_methods.check', 'CHECK', '20'),
        pm('49', 'ledger.provisioning.payment_methods.debit_card', 'DEBIT_CARD', '49'),
        pm('48', 'ledger.provisioning.payment_methods.credit_card', 'CREDIT_CARD', '48'),
        pm('CREDITO', 'ledger.provisioning.payment_methods.on_account', 'CREDIT'),
      ],
    },
  }),

  BR: latamPack('BR', { city: 'São Paulo', postalCode: '01310-100', phone: '(11) 5555-0123' }, {
    booksLanguage: 'pt',
    documents: { ...LATAM_DOCUMENTS, supplierDocumentNumberKey: 'localization.country_pack.supplier_document.nfe_key' },
    taxes: { model: 'BY_JURISDICTION', nameKey: 'localization.country_pack.tax_name.icms_iss' },
    // SEFAZ `tPag` (NF-e 4.00): PIX and boleto are how Brazil pays.
    paymentMethods: {
      catalogue: 'EDITABLE',
      authority: 'SEFAZ',
      defaults: [
        pm('17', 'ledger.provisioning.payment_methods.pix', 'BANK_TRANSFER', '17'),
        pm('15', 'ledger.provisioning.payment_methods.boleto', 'BANK_TRANSFER', '15'),
        pm('18', 'ledger.provisioning.payment_methods.bank_transfer', 'BANK_TRANSFER', '18'),
        pm('01', 'ledger.provisioning.payment_methods.cash', 'CASH', '01'),
        pm('03', 'ledger.provisioning.payment_methods.credit_card', 'CREDIT_CARD', '03'),
        pm('04', 'ledger.provisioning.payment_methods.debit_card', 'DEBIT_CARD', '04'),
        pm('02', 'ledger.provisioning.payment_methods.check', 'CHECK', '02'),
      ],
    },
  }),

  CL: latamPack('CL', { city: 'Santiago', postalCode: '8320000', phone: '2 2555 0123' }),
  PE: latamPack('PE', { city: 'Lima', postalCode: '15001', phone: '01 555 0123' }),
  AR: latamPack('AR', { city: 'Buenos Aires', postalCode: 'C1002AAA', phone: '011 5555-0123' }),
  EC: latamPack('EC', { city: 'Quito', postalCode: '170150', phone: '02 255 0123' }),
  UY: latamPack('UY', { city: 'Montevideo', postalCode: '11000', phone: '2 555 0123' }),
  PY: latamPack('PY', { city: 'Asunción', postalCode: '1209', phone: '021 555 012' }),
  BO: latamPack('BO', { city: 'La Paz', postalCode: null, phone: '2 255 0123' }),
  VE: latamPack('VE', { city: 'Caracas', postalCode: '1010', phone: '0212 555 0123' }),
  PA: latamPack('PA', { city: 'Ciudad de Panamá', postalCode: null, phone: '255 0123' }),
  CR: latamPack('CR', { city: 'San José', postalCode: '10101', phone: '2255 0123' }),
  GT: latamPack('GT', { city: 'Ciudad de Guatemala', postalCode: '01001', phone: '2255 0123' }),
  SV: latamPack('SV', { city: 'San Salvador', postalCode: null, phone: '2255 0123' }),
  HN: latamPack('HN', { city: 'Tegucigalpa', postalCode: '11101', phone: '2255 0123' }),
  NI: latamPack('NI', { city: 'Managua', postalCode: '10000', phone: '2255 0123' }),
};

/**
 * The pack of a market.
 *
 * A market with no pack — a tenant whose country was never set, or one this product does not sell
 * in — gets a neutral pack that claims nothing country-specific: no authority numbering, no
 * withholding, the generic payment methods, editable; the ledgers as the way to prepare its returns.
 * Neutral, not Dominican: the failure this file exists to fix is precisely an unknown market
 * inheriting the first market's answers.
 */
export function countryPackFor(countryCode: string | null | undefined): CountryPack {
  const code = (countryCode ?? '').trim().toUpperCase();
  return COUNTRY_PACKS[code] ?? neutralPack(code);
}

function neutralPack(countryCode: string): CountryPack {
  return {
    countryCode,
    booksLanguage: null,
    documents: {
      fiscalNumbering: false,
      supplierFiscalNumber: false,
      supplierDocumentNumberKey: 'localization.country_pack.supplier_document.invoice_number',
      purchaseClassification: false,
    },
    withholding: { applies: false },
    taxes: VAT,
    paymentMethods: { catalogue: 'EDITABLE', authority: null, defaults: GENERIC_PAYMENT_METHODS },
    payroll: NO_PAYROLL_SEEDS,
    defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
    fiscalReturns: { generator: null, dueDay: null, prepareWith: PREPARE_WITH_LEDGERS },
    examples: { city: '', postalCode: null, phone: '' },
  };
}

/**
 * Every name a default customer has been seeded under, in every language, so a backfill can tell
 * the row provisioning created from one a person named.
 */
export const DEFAULT_CUSTOMER_NAME_KEYS: readonly string[] = [
  'ledger.provisioning.final_consumer',
  'ledger.provisioning.walk_in_customer',
  'ledger.provisioning.general_public',
];
