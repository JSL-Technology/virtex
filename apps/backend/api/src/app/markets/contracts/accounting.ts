/**
 * What a market adds to, or requires of, the starting chart of accounts.
 *
 * The plan itself — an IFRS structure written in the market's books language — is built by the
 * chart-of-accounts engine, the same for every market. A market declares only what is its own:
 * the institutions its payroll is remitted to, the name of its excise tax and service charge, the
 * authority's grouping codes, and whether its law prescribes an official plan instead.
 */

/** One segment of an account code. */
export interface CoaSegmentSpec {
  name: string;
  length: number;
  isRequired: boolean;
}

/** Payroll liability and expense account names, in the market's own institutions. */
export interface PayrollAccountNames {
  pension: string;
  health: string;
  otherContributions: string;
  incomeTaxWithheld: string;
  employerContributions: string;
}

export interface MarketAccounting {
  /**
   * The official plan the market's law prescribes, where it does (Colombia's PUC, Peru's PCGE),
   * named so the gap is visible: the starting plan does not reproduce it. Null where none is
   * required.
   */
  statutoryPlanRequired: string | null;
  /** The account-code structure, where the market's plan uses another shape than the default. */
  segments: readonly CoaSegmentSpec[] | null;
  /** Payroll accounts named after the market's institutions; the neutral names otherwise. */
  payrollAccounts: Partial<PayrollAccountNames> | null;
  /** The excise tax account, under the market's own name for the tax (ISC, IEPS, ICE, INC). */
  exciseTaxAccount: string | null;
  /** The legal service charge account, for a market whose taxes declare a service charge. */
  serviceChargeAccount: string | null;
  /** The authority's grouping code per template account code (Mexico's «código agrupador»). */
  fiscalGroupingCodes: Readonly<Record<string, string>> | null;
  /**
   * Names in the plan that belong to this market's institutions only. A plan provisioned for any
   * other market must contain none of them; tests assert it, which is what keeps one market's
   * vocabulary from becoming everyone's default again.
   */
  exclusiveTerms: readonly RegExp[];
}
