import type { MarketDefinition } from './contracts';
import { MARKET_DEFINITIONS } from './catalogue';
import { Market, neutralMarket } from './neutral';

/**
 * How the product finds a market: by its ISO code, through here, and never by naming it.
 *
 * `marketFor` always answers — with the neutral market for a code no package declares — so a caller
 * reads a capability without a branch for «unknown». `knownMarket` is for the callers that must
 * refuse a country the product does not sell in (signup, provisioning).
 */
const BY_CODE: ReadonlyMap<string, MarketDefinition> = new Map(MARKET_DEFINITIONS.map((m) => [m.code, m]));

/** ISO 3166-1 alpha-2, upper case, without surrounding blanks. */
export function normalizeMarketCode(countryCode: string | null | undefined): string {
  return (countryCode ?? '').trim().toUpperCase();
}

/** The market, or the neutral answer for a code no package declares. */
export function marketFor(countryCode: string | null | undefined): Market {
  const code = normalizeMarketCode(countryCode);
  return BY_CODE.get(code) ?? neutralMarket(code);
}

/** The market, or null when the product is not sold there. */
export function knownMarket(countryCode: string | null | undefined): MarketDefinition | null {
  return BY_CODE.get(normalizeMarketCode(countryCode)) ?? null;
}

export function isKnownMarket(countryCode: string | null | undefined): boolean {
  return BY_CODE.has(normalizeMarketCode(countryCode));
}

/** Every market, in the order a country selector offers them. */
export function allMarkets(): readonly MarketDefinition[] {
  return MARKET_DEFINITIONS;
}

export function marketCodes(): readonly string[] {
  return MARKET_DEFINITIONS.map((m) => m.code);
}
