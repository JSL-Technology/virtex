/**
 * What the product does in a market, per capability, stated in the product.
 *
 * Every capability of every market has a declared level — the market's own file states it next to
 * the capability it describes — so the signup disclosure, the settings page and the engines read
 * one statement that cannot drift from what the code does.
 *
 * - `implemented` — built, tested, and reachable in the product.
 * - `needs-credentials` — built and tested; the last step needs something only the taxpayer can
 *   supply: their certificate, their PAC contract, their homologation with the authority.
 * - `needs-configuration` — built; it cannot run until the tenant's own data says something only
 *   they can decide.
 * - `not-implemented` — not built. Said plainly rather than dressed as a preview.
 * - `not-applicable` — the market has no such obligation: a US sales invoice carries no fiscal
 *   stamp and no withholding. Saying «implemented» would claim work that does not exist; saying «not
 *   implemented» would suggest something is missing that the law does not ask for.
 */
export type CoverageLevel =
  | 'implemented'
  | 'needs-credentials'
  | 'needs-configuration'
  | 'not-implemented'
  | 'not-applicable';

/** Stable keys, for the client to translate. */
export type CoverageCapability =
  | 'accounting'
  | 'taxDetermination'
  | 'electronicInvoicing'
  | 'periodicReturns'
  | 'electronicAccounting'
  | 'withholding'
  | 'payroll'
  | 'debitNotes'
  | 'documentCancellation';

/** One capability's state, as a market's file declares it. */
export interface CoverageLine {
  level: CoverageLevel;
  /** The regime or filing this refers to, in the authority's own words. */
  detail?: string;
  /** What the tenant must supply, when the level asks for something. */
  requires?: string;
}

export interface CapabilityCoverage extends CoverageLine {
  capability: CoverageCapability;
}

export interface MarketCoverage {
  countryCode: string;
  capabilities: CapabilityCoverage[];
}
