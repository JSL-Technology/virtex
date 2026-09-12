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
}

/** The bases a payslip presents to the statutory engine, already prorated and summed. */
export interface StatutoryInput {
  /** Monthly contributory base — the sum of earnings that form the TSS base, before any cap. */
  contributoryBase: number;
  /** Monthly taxable earnings for income tax, before subtracting the employee's own AFP+SFS. */
  taxableEarnings: number;
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
}
