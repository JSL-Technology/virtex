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

/** The social-security regimes a contribution row can describe. */
export enum ContributionRegime {
  /** Pension fund — AFP (Administradora de Fondos de Pensiones). */
  AFP = 'AFP',
  /** Health — SFS/SDSS (Seguro Familiar de Salud). */
  SFS = 'SFS',
  /** Labour-risk insurance — SRL (Seguro de Riesgos Laborales), employer-borne. */
  SRL = 'SRL',
  /** Vocational-training levy — INFOTEP. */
  INFOTEP = 'INFOTEP',
}

/** What a rate is applied to. */
export enum ContributionBase {
  /** The salary, capped at a multiple of the minimum contributory wage. AFP/SFS/SRL work this way. */
  SALARY_CAPPED = 'SALARY_CAPPED',
  /** The whole payroll, uncapped. INFOTEP's employer levy works this way. */
  PAYROLL_UNCAPPED = 'PAYROLL_UNCAPPED',
}
