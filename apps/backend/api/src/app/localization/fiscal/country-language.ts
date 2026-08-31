import { LanguageCode, languageOfLocale } from '@virteex/shared/types';
import { findCountryProfile } from './country-profiles';

/**
 * The language a country's business documents are written in.
 *
 * Derived from the country profile's own `locale` rather than from a second table, so a market
 * added there cannot be forgotten here — `pt-BR` yields Portuguese without anybody remembering to
 * say so twice.
 *
 * Used for two of the three language axes:
 *
 *  - **Books.** A tenant's ledger is opened in the statutory language of its country, and stays
 *    there whoever reads it. An auditor asking for the chart of accounts expects the names it was
 *    filed under.
 *  - **Documents**, as the fallback. An invoice follows its recipient's stated preference; when
 *    they have not stated one, their country is the better guess than the issuer's language.
 *
 * NOT used for the interface, which follows the person reading it — see `LanguageAxis`.
 */
export function languageOfCountry(countryCode?: string | null): LanguageCode | null {
  const profile = findCountryProfile((countryCode ?? '').toUpperCase());
  return profile ? languageOfLocale(profile.locale) : null;
}
