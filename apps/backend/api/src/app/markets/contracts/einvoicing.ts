import type { CoverageLine } from './coverage';

/**
 * Whether a market's law requires electronic invoicing, and what the product does about it.
 */
export interface MarketEInvoicing {
  /** The market's law mandates electronic invoicing. A fact about the country, not the product. */
  required: boolean;
  /** The regime's own name, as the authority calls it, or null where there is none. */
  regime: string | null;
  /** What the product does with the regime. */
  coverage: CoverageLine;
}
