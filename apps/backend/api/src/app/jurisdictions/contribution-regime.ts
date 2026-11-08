/**
 * The vocabulary of a country's statutory social-security rules.
 *
 * These enums describe *what kind of thing* a statutory rate is and *what it applies to* — the
 * shared language between a jurisdiction's strategy (which computes the rate) and the payroll table
 * that stores the versioned rate itself. They live in the jurisdictions module, not in payroll,
 * because both payroll (the rate table) and any other consumer of a country's statutory rules read
 * them from here; keeping them in a payroll entity would force the jurisdictions module to import
 * payroll and re-create the very cycle this module exists to prevent.
 */

// There is no shared enum of contribution codes any more (audit 2026-11-07, JUR-01): it listed the
// four Dominican regimes (AFP, SFS, SRL, INFOTEP) as if they were everyone's. Each country's
// strategy declares its own catalogue (`PayrollJurisdictionStrategy.contributionConcepts`) and the
// versioned rate table stores the code as text.

/** What a rate is applied to. */
export enum ContributionBase {
  /** The salary, bounded by multiples of the minimum contributory wage (DO: AFP, SFS, SRL). */
  SALARY_CAPPED = 'SALARY_CAPPED',
  /** The whole payroll, uncapped (DO: INFOTEP's employer levy). */
  PAYROLL_UNCAPPED = 'PAYROLL_UNCAPPED',
}
