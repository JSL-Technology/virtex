/**
 * A market's fiscal profile, as other modules may read it: its tax authority, its electronic
 * invoicing regime, its calling code.
 *
 * Electronic invoicing names the authority in its messages and on the printed document; reading it
 * from here keeps every market's wording in the one catalogue that defines the market.
 */
export { findCountryProfile, type CountryFiscalProfile } from '../fiscal/country-profiles';

/**
 * The statutory language of a market's books, from its profile. Provisioning opens a tenant's ledger
 * — and names its seeded customer, journals and payment methods — in it.
 */
export { languageOfCountry } from '../fiscal/country-language';

/**
 * A market's consumption-tax scheme. A till reads `configurationRequired` to warn that the market
 * has no national rate (United States, Brazil) and the tenant has to set one up.
 */
export { findTaxScheme, type CountryTaxScheme } from '../fiscal/country-tax-schemes';
