import { ContributionBase } from './contribution-regime';

/**
 * The statutory parameters in force for a country on a date, resolved once and then frozen.
 *
 * This is the shape {@link PayrollParametersService} produces and the shape a run snapshots. It is
 * plain data on purpose: the strategy that consumes it is a pure function of `(bases, parameters)`,
 * which is what makes the calculation unit-testable without a database and reproducible from a
 * snapshot.
 */
export interface ResolvedContribution {
  /** The contribution's code in the country's catalogue (`AFP`, `IMSS_EYM`…); see {@link ContributionConcept}. */
  code: string;
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

/** The statutory outcome of a year-end bonus. */
export interface BonusResult {
  /** The statutory levies withheld from the bonus, in the same shape as an ordinary run's. */
  contributions: ContributionResult[];
  /** Net bonus paid to the employee. */
  net: number;
}

/**
 * Which liability a contribution is owed under, in the ledger.
 *
 * A country has as many funds as its law creates (four in DO, five in MX, six in CO); the ledger
 * has three payroll liabilities beside the net wage and the income tax, one per KIND of fund. The
 * strategy says which kind each of its contributions is, so the posting never names an
 * institution (audit 2026-11-07, JUR-01).
 */
export type ContributionBucket = 'PENSION' | 'HEALTH' | 'OTHER';

/**
 * One entry of a country's contribution catalogue — the RULE about a contribution. Its RATES are
 * versioned data in `payroll_statutory_contributions`, keyed by the same `code`.
 */
export interface ContributionConcept {
  /** Stable code, upper snake case, unique within the country. */
  code: string;
  /** Catalogue key of its name, so screens and payslips name it in the reader's language. */
  labelKey: string;
  /** The name written on a payslip line, in the country's own terms. */
  name: string;
  bucket: ContributionBucket;
  /** True when the employee's share is deducted before income tax (AFP and SFS in DO). */
  reducesTaxableIncome: boolean;
}

/** One contribution's computed result, keeping the employer/employee split explicit. */
export interface ContributionResult {
  code: string;
  bucket: ContributionBucket;
  /** The base actually used after applying the contribution's floor and cap. */
  appliedBase: number;
  employeeRate: number;
  employerRate: number;
  employeeAmount: number;
  employerAmount: number;
}

/** The full statutory outcome for one employee for one period. */
export interface StatutoryResult {
  contributions: ContributionResult[];
  /** Sum of the employee shares withheld. */
  employeeContributions: number;
  /** Sum of the employer shares, an added cost. */
  employerContributions: number;
  incomeTax: number;
  /** Taxable earnings net of the employee shares that reduce taxable income. */
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
/**
 * A statutory identifier a country's social security system assigns to a worker.
 *
 * ## Why this is on the jurisdiction strategy
 *
 * `employees` carried three columns named after Dominican institutions — `tss_nss` (Tesorería de
 * la Seguridad Social), `afp_code`, `sfs_code` — and the DTO asserted `@Matches(/^\d{7,11}$/)`,
 * the shape of a Dominican NSS, on every country's employees. A Mexican worker has an IMSS number,
 * a Brazilian a PIS/PASEP, a Colombian an EPS and an AFP affiliation with different structures
 * again. The columns are now neutrally named and the RULE lives here, with the strategy that
 * already knows the country's payroll law, rather than as a regex on a shared DTO.
 *
 * A country whose strategy declares no identifiers imposes no format, which is the correct
 * behaviour for a market whose rules this product has not modelled yet — it is weaker than a
 * verified rule and infinitely stronger than another country's rule.
 */
export interface StatutoryIdentifierSpec {
  /**
   * Which field it constrains.
   *
   * `socialSecurityNumber`, `pensionFundCode` and `healthFundCode` are the three neutral columns
   * on `employees`; anything else is a key inside `statutory_enrolment`, so a country needing a
   * fourth identifier adds it without a migration.
   */
  field: 'socialSecurityNumber' | 'pensionFundCode' | 'healthFundCode' | string;
  /** Catalogue key for the field's label, so the form can name it in the country's terms. */
  labelKey: string;
  /** Anchored on both ends. Null means the country imposes no shape this product can assert. */
  pattern: string | null;
  /** Catalogue key for the rejection message, phrased in that country's vocabulary. */
  messageKey: string;
  required: boolean;
}

export interface PayrollJurisdictionStrategy {
  readonly countryCode: string;
  /**
   * Every statutory contribution this country's law levies on a payroll. A rate row whose code is
   * not here is a data defect and is refused, never guessed at.
   */
  readonly contributionConcepts: readonly ContributionConcept[];
  /** How the income-tax withholding is named on a payslip line. */
  readonly incomeTaxConcept: { code: string; name: string; labelKey: string };
  /**
   * The statutory identifiers this country's filings need from an employee record.
   *
   * Empty by default: a strategy that has not modelled them asserts nothing rather than borrowing
   * another country's rule.
   */
  readonly statutoryIdentifiers?: readonly StatutoryIdentifierSpec[];
  /** Compute all statutory contributions and income tax from the prorated bases. Pure. */
  computeStatutory(input: StatutoryInput, params: ResolvedParameters): StatutoryResult;
  /**
   * The statutory treatment of a year-end bonus (DO: the regalía pascual, exempt from income tax and
   * outside the AFP/SFS base, but subject to the employee INFOTEP levy). Pure.
   */
  computeBonus(input: BonusInput, params: ResolvedParameters): BonusResult;
}
