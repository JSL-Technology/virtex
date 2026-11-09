// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPayroll, PayrollConceptSeed } from '../contracts';
import { implemented } from '../kit/coverage';

/**
 * Payroll concepts for the Dominican engine — the only jurisdiction with a payroll strategy.
 *
 * The statutory rows (AFP, SFS, ISR) carry no amount: the engine computes them from the versioned
 * parameters. They exist so the payslip names them and an account can be attached. The others are
 * the lines a Dominican payroll uses in its first month: overtime at the Labour Code's premiums,
 * the night premium, a bonus, a commission, a loan repayment and an advance.
 */
const CONCEPTS: readonly PayrollConceptSeed[] = [
  { code: 'HE35', nameKey: 'payroll.concepts.seed.overtime_35', type: 'EARNING', calculation: 'HOURLY', rate: 1.35, taxable: true, contributesToSocialSecurity: true, sortOrder: 20, isSystem: false },
  { code: 'HE100', nameKey: 'payroll.concepts.seed.overtime_100', type: 'EARNING', calculation: 'HOURLY', rate: 2, taxable: true, contributesToSocialSecurity: true, sortOrder: 21, isSystem: false },
  { code: 'NOCT', nameKey: 'payroll.concepts.seed.night_premium', type: 'EARNING', calculation: 'HOURLY', rate: 0.15, taxable: true, contributesToSocialSecurity: true, sortOrder: 22, isSystem: false },
  { code: 'BONO', nameKey: 'payroll.concepts.seed.bonus', type: 'EARNING', calculation: 'FIXED', rate: null, taxable: true, contributesToSocialSecurity: false, sortOrder: 30, isSystem: false },
  { code: 'COMISION', nameKey: 'payroll.concepts.seed.commission', type: 'EARNING', calculation: 'FIXED', rate: null, taxable: true, contributesToSocialSecurity: true, sortOrder: 31, isSystem: false },
  { code: 'AFP', nameKey: 'payroll.concepts.seed.afp', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 200, isSystem: true },
  { code: 'SFS', nameKey: 'payroll.concepts.seed.sfs', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 201, isSystem: true },
  { code: 'ISR', nameKey: 'payroll.concepts.seed.isr', type: 'DEDUCTION', calculation: 'STATUTORY', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 210, isSystem: true },
  { code: 'PRESTAMO', nameKey: 'payroll.concepts.seed.loan_repayment', type: 'DEDUCTION', calculation: 'FIXED', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 300, isSystem: false },
  { code: 'ANTICIPO', nameKey: 'payroll.concepts.seed.salary_advance', type: 'DEDUCTION', calculation: 'FIXED', rate: null, taxable: false, contributesToSocialSecurity: false, sortOrder: 301, isSystem: false },
];

/** Dominican Republic: the platform keeps the statutory rates; the payroll engine computes them. */
export const payroll: MarketPayroll = {
  statutoryParameters: 'PLATFORM',
  parameters: [],
  concepts: CONCEPTS,
  coverage: implemented('SDSS (AFP, SFS, SRL), INFOTEP e ISR asalariados'),
};
