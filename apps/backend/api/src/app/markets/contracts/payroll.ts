import type { CoverageLine } from './coverage';

/**
 * What a market's payroll starts with, and whether the product computes it.
 */

/** What a company payroll parameter is. */
export type PayrollParameterKind =
  /** A rate on wages, split employee/employer, optionally capped by an annual wage base. */
  | 'CONTRIBUTION'
  /** A withholding table (brackets) the company enters from the authority's publication. */
  | 'TABLE'
  /** A single amount (a minimum wage, an allowance). */
  | 'AMOUNT';

/**
 * A payroll parameter a company starts with, as an editable statutory default. Every figure carries
 * the date it takes effect, because statutory rates move every year and a payroll recomputed for a
 * past period must keep the figure in force then.
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
  /** Credit against the rate. */
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
  /** Part of the social-security base. */
  contributesToSocialSecurity: boolean;
  sortOrder: number;
  isSystem: boolean;
}

export interface MarketPayroll {
  /**
   * Who keeps the statutory rates: the platform, for a market whose rules the payroll engine
   * computes, or the company itself, for one whose rates it records as editable defaults.
   */
  statutoryParameters: 'PLATFORM' | 'COMPANY';
  parameters: readonly PayrollParameterSeed[];
  concepts: readonly PayrollConceptSeed[];
  /** Whether the product computes the market's statutory payroll. */
  coverage: CoverageLine;
}
