import type { BooksLanguage } from '../contracts';
import { neutralMarket } from '../neutral';
import { allMarkets, knownMarket } from '../registry';

/**
 * The profile facts across the catalogue that callers ask for by country code.
 */

/**
 * The name of a first-level division from its code — `('DO', '32')` → «Santo Domingo» — or null when
 * the market codes none or the code is unknown. Addresses store the code the e-invoicing schemas
 * require; a printed document shows the name.
 */
export function divisionName(countryCode: string | null | undefined, code: string | null | undefined): string | null {
  if (!countryCode || !code) return null;
  const divisions = knownMarket(countryCode)?.profile.address.divisions;
  return divisions?.find((division) => division.code === code.trim().toUpperCase())?.name ?? null;
}

/**
 * The language a market's books and business documents are written in, or null for a country the
 * product is not sold in.
 *
 *  - **Books.** A ledger is opened in the statutory language of its country, and stays there whoever
 *    reads it.
 *  - **Documents**, as the fallback: an invoice follows its recipient's stated preference, and when
 *    they have stated none, their country is the better guess than the issuer's language.
 *
 * Not the interface language, which follows the person reading it.
 */
export function languageOfCountry(countryCode: string | null | undefined): BooksLanguage | null {
  return knownMarket(countryCode)?.profile.booksLanguage ?? null;
}

/**
 * The currency a company of this country keeps its books in when nothing else says so: its
 * market's. For a country the product is not sold in, the US dollar — the currency the region's
 * cross-border reporting is most often translated into — which the company can change before it
 * posts anything. One rule for signup and for reprovisioning; each used to carry its own copy.
 */
export function baseCurrencyOf(countryCode: string | null | undefined): string {
  return knownMarket(countryCode)?.profile.currency ?? FALLBACK_BASE_CURRENCY;
}

/** The base currency of a company whose country is not a market of the product. */
export const FALLBACK_BASE_CURRENCY = 'USD';

/**
 * Every name a default customer has been seeded under, so a backfill can tell the row provisioning
 * created from one a person named.
 */
export const DEFAULT_CUSTOMER_NAME_KEYS: readonly string[] = Object.freeze([
  ...new Set([
    ...allMarkets().map((market) => market.documents.defaultCustomer.nameKey),
    // The neutral market's, for a company whose country was never set.
    neutralMarket('').documents.defaultCustomer.nameKey,
  ]),
]);
