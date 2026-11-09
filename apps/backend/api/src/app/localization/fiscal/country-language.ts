import type { LanguageCode } from '@virteex/shared/types';
import { knownMarket } from '../../markets';

/**
 * The language a country's business documents are written in: the market's declared books
 * language (`markets/<cc>/profile.ts`).
 *
 * Used for two of the three language axes:
 *
 *  - **Books.** A tenant's ledger is opened in the statutory language of its country, and stays
 *    there whoever reads it.
 *  - **Documents**, as the fallback. An invoice follows its recipient's stated preference; when they
 *    have not stated one, their country is the better guess than the issuer's language.
 *
 * NOT used for the interface, which follows the person reading it — see `LanguageAxis`.
 */
export function languageOfCountry(countryCode?: string | null): LanguageCode | null {
  return knownMarket(countryCode)?.profile.booksLanguage ?? null;
}
