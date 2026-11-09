// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPayroll, PayrollConceptSeed, PayrollParameterSeed } from '../contracts';
import { notImplemented } from '../kit/coverage';

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
const PARAMETERS: readonly PayrollParameterSeed[] = [
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
const CONCEPTS: readonly PayrollConceptSeed[] = [
  { code: 'OT', nameKey: 'payroll.concepts.seed.us_overtime', type: 'EARNING', calculation: 'HOURLY', rate: 1.5, taxable: true, contributesToSocialSecurity: true, sortOrder: 20, isSystem: false },
  { code: 'BONUS', nameKey: 'payroll.concepts.seed.bonus', type: 'EARNING', calculation: 'FIXED', rate: null, taxable: true, contributesToSocialSecurity: true, sortOrder: 30, isSystem: false },
  { code: 'COMMISSION', nameKey: 'payroll.concepts.seed.commission', type: 'EARNING', calculation: 'FIXED', rate: null, taxable: true, contributesToSocialSecurity: true, sortOrder: 31, isSystem: false },
  { code: 'TIPS', nameKey: 'payroll.concepts.seed.us_tips', type: 'EARNING', calculation: 'FIXED', rate: null, taxable: true, contributesToSocialSecurity: true, sortOrder: 32, isSystem: false },
  { code: 'SS', nameKey: 'payroll.concepts.seed.us_social_security', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 200, isSystem: true },
  { code: 'MEDICARE', nameKey: 'payroll.concepts.seed.us_medicare', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 201, isSystem: true },
  { code: 'FIT', nameKey: 'payroll.concepts.seed.us_federal_income_tax', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 210, isSystem: true },
  { code: 'SIT', nameKey: 'payroll.concepts.seed.us_state_income_tax', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 211, isSystem: true },
  { code: '401K', nameKey: 'payroll.concepts.seed.us_401k', type: 'DEDUCTION', calculation: 'PERCENTAGE', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 250, isSystem: false },
  { code: 'ER_SS', nameKey: 'payroll.concepts.seed.us_employer_social_security', type: 'EMPLOYER_CONTRIBUTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 400, isSystem: true },
  { code: 'ER_MEDICARE', nameKey: 'payroll.concepts.seed.us_employer_medicare', type: 'EMPLOYER_CONTRIBUTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 401, isSystem: true },
  { code: 'FUTA', nameKey: 'payroll.concepts.seed.us_futa', type: 'EMPLOYER_CONTRIBUTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 402, isSystem: true },
  { code: 'SUTA', nameKey: 'payroll.concepts.seed.us_suta', type: 'EMPLOYER_CONTRIBUTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 403, isSystem: true },
  { code: 'LOAN', nameKey: 'payroll.concepts.seed.loan_repayment', type: 'DEDUCTION', calculation: 'FIXED', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 300, isSystem: false },
  { code: 'ADVANCE', nameKey: 'payroll.concepts.seed.salary_advance', type: 'DEDUCTION', calculation: 'FIXED', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 301, isSystem: false },
];

/** United States: the company keeps its rates, starting from the federal defaults above. */
export const payroll: MarketPayroll = {
  statutoryParameters: 'COMPANY',
  parameters: PARAMETERS,
  concepts: CONCEPTS,
  coverage: notImplemented(),
};
