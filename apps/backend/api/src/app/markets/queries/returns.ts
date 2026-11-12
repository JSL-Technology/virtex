import type { MarketReturnFiling, MarketReturnOption } from '../contracts';
import { marketFor } from '../registry';

/**
 * What a market files, asked for by country.
 *
 * The engine that builds a return knows nothing about any authority: it resolves the filing here,
 * assembles the period's facts and hands them over. The Dominican formats used to be four methods
 * of the compliance service, reachable by any tenant until a country check was added by hand at the
 * top of each one (docs/ARQUITECTURA_MERCADOS.md, fase 5).
 */
export function returnFilingsOf(countryCode: string | null | undefined): readonly MarketReturnFiling[] {
  return marketFor(countryCode).returns.filings;
}

/** One filing by the authority's own name for it, or null where this market files no such thing. */
export function returnFilingFor(
  countryCode: string | null | undefined,
  code: string,
): MarketReturnFiling | null {
  const wanted = code.trim().toLowerCase();
  return returnFilingsOf(countryCode).find((filing) => filing.code.toLowerCase() === wanted) ?? null;
}

/** The options a filing accepts, by name. */
export function returnFilingOptions(filing: MarketReturnFiling): ReadonlyMap<string, MarketReturnOption> {
  return new Map((filing.options ?? []).map((option) => [option.name, option]));
}
