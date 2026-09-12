import { ContributionBase, ContributionRegime } from '../entities/statutory-contribution.entity';

/**
 * The statutory parameters in force for a country on a date, resolved once and then frozen.
 *
 * This is the shape {@link PayrollParametersService} produces and the shape a run snapshots. It is
 * plain data on purpose: the strategy that consumes it is a pure function of `(bases, parameters)`,
 * which is what makes the calculation unit-testable without a database and reproducible from a
 * snapshot.
 */
export interface ResolvedContribution {
  regime: ContributionRegime;
  employeeRate: number;
  employerRate: number;
  base: ContributionBase;
  /** Cap as a multiple of the minimum contributory wage; null means uncapped. */
  capMinWageMultiplier: number | null;
  /**
   * Floor as a multiple of the minimum contributory wage; null means no floor. TSS will not accept a
   * contributory base below one minimum wage for a full-time worker, so the seed sets this to 1 for
   * AFP/SFS. It is applied only to a full-period base — see {@link StatutoryInput.prorationFactor} —
   * so a part-month worker is not over-charged.
   */
  floorMinWageMultiplier: number | null;
}

export interface ResolvedTaxBracket {
  lowerAnnual: number;
  upperAnnual: number | null;
  rate: number;
  accumulatedTax: number;
}

export interface ResolvedParameters {
  countryCode: string;
  /** The date the parameters were resolved for — the run's period end. */
  effectiveDate: string;
  minWageCotizable: number;
  contributions: ResolvedContribution[];
  taxBrackets: ResolvedTaxBracket[];
  currencyCode: string;
  /**
   * Employee INFOTEP levy withheld from the year-end bonus (regalía), as a fraction. The 0.5 % the
   * law charges the worker on the bonus lives here, versioned like every other rate, rather than as a
   * literal in the christmas-bonus path. Zero/absent means none.
   */
  bonusEmployeeLevyRate: number;
}

/** The bases a payslip presents to the statutory engine, already prorated and summed. */
export interface StatutoryInput {
  /** Monthly contributory base — the sum of earnings that form the TSS base, before any cap. */
  contributoryBase: number;
  /** Monthly taxable earnings for income tax, before subtracting the employee's own AFP+SFS. */
  taxableEarnings: number;
  /**
   * Worked ÷ base days for the period (1 for a full month). Income tax is a function of the *ordinary*
   * salary level, so a partial month is taxed by grossing the taxable base up to a full month, taxing
   * that, and prorating the result back — otherwise a mid-month hire is under-withheld against the
   * DGII scale. The floor on the contributory base is likewise only applied when this is 1. Defaults
   * to 1 when omitted.
   */
  prorationFactor?: number;
}

/** The bases a 13th-month (regalía) run presents to the statutory engine. */
export interface BonusInput {
  /** The bonus amount (one twelfth of the ordinary salary earned in the year). */
  bonusAmount: number;
}

/** The statutory outcome of a year-end bonus: ISR-exempt, outside AFP/SFS, INFOTEP-levied. */
export interface BonusResult {
  /** Employee INFOTEP levy withheld from the bonus. */
  infotepEmployee: number;
  /** Net bonus paid to the employee. */
  net: number;
}

/** One regime's computed result, keeping the employer/employee split explicit. */
export interface ContributionResult {
  regime: ContributionRegime;
  /** The base actually used after applying the regime's cap. */
  appliedBase: number;
  employeeRate: number;
  employerRate: number;
  employeeAmount: number;
  employerAmount: number;
}

/** The full statutory outcome for one employee for one period. */
export interface StatutoryResult {
  contributions: ContributionResult[];
  /** Employee-withheld shares, summed by regime for the payslip's summary columns. */
  afpEmployee: number;
  afpEmployer: number;
  sfsEmployee: number;
  sfsEmployer: number;
  srlEmployer: number;
  infotepEmployer: number;
  incomeTax: number;
  /** Taxable earnings net of the employee's AFP+SFS — the base income tax was applied to. */
  taxableBase: number;
}

/**
 * A country's payroll rules, as a strategy.
 *
 * The audit's architectural requirement: the Dominican rules must not be hardcoded in a way that
 * makes another country a rewrite. Each jurisdiction is one implementation of this interface,
 * registered by country code; the calculation service selects one and never contains a country's
 * arithmetic itself. Adding Colombia or the US is adding a class here.
 */
export interface PayrollJurisdictionStrategy {
  readonly countryCode: string;
  /** Compute all statutory contributions and income tax from the prorated bases. Pure. */
  computeStatutory(input: StatutoryInput, params: ResolvedParameters): StatutoryResult;
  /**
   * The statutory treatment of a year-end bonus (regalía pascual): exempt from income tax, outside
   * the AFP/SFS contributory base, but subject to the employee INFOTEP levy. Pure.
   */
  computeBonus(input: BonusInput, params: ResolvedParameters): BonusResult;
}
