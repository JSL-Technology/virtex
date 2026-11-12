import type { CoverageLine } from './coverage';

/**
 * Whether a market's law requires electronic invoicing, and what the product does about it.
 */
export interface MarketEInvoicing {
  /** The market's law mandates electronic invoicing. A fact about the country, not the product. */
  required: boolean;
  /** The regime's own name, as the authority calls it, or null where there is none. */
  regime: string | null;
  /**
   * How the taxpayer authenticates to the regime.
   *
   * `CERTIFICATE`: the authority publishes its own endpoints and authenticates with the taxpayer's
   * signing certificate, so there is no channel to configure (the DGII). `ENDPOINT`: the company
   * contracts an endpoint and a credential — its authority's, or an authorised agent's — and
   * configures them (`fiscal_regime_settings`). Null where the market has no regime.
   */
  channel: 'CERTIFICATE' | 'ENDPOINT' | null;
  /**
   * What the regime needs from the company beyond the environment, by field name, for the screen
   * that asks for it: `establishment` and `emissionPoint` in Ecuador, `stateCode` and
   * `municipalityCode` in Brazil, the DIAN's `resolutionNumber`, the SII's `activityCode`.
   *
   * The screen used to carry this list itself, keyed by country code, so a market that gained a
   * regime asked for nothing until the client was edited too.
   */
  settingsFields: readonly string[];
  /**
   * What the authority issues WITH an authorised range, where it issues anything: Chile's CAF file,
   * the DIAN's technical key. Null where a range is numbers alone.
   */
  rangeSecret: 'AUTHORISED_FOLIOS' | 'TECHNICAL_KEY' | null;
  /** What the product does with the regime. */
  coverage: CoverageLine;
}
