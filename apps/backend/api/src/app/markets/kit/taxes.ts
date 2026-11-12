import type { MarketTax, MarketWithholding } from '../contracts';

/** A value-added tax at a national rate, in percentage points. */
export const valueAddedTax = (name: string, rate: number): MarketTax => ({
  name,
  rate,
  computation: 'PERCENTAGE',
  regime: 'VAT',
});

/**
 * A market whose withholding the product will not guess at: it has withholding, and the rate turns on
 * something the product cannot know (the municipality, the activity code, a classification the
 * authority assigns per taxpayer). The tenant configures its own regimes; until it does, nothing is
 * withheld automatically.
 */
export const withholdingConfiguredByTenant = (configurationNote: string): MarketWithholding => ({
  applies: true,
  regimes: [],
  configurationRequired: true,
  configurationNote,
});
