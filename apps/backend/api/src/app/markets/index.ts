/**
 * The markets the product is sold in (docs/ARQUITECTURA_MERCADOS.md).
 *
 * The only door into `markets/`: the registry and the contract. Nothing outside this folder imports a
 * market package (`markets/<cc>/`) — `verify:country-neutrality` refuses it — so no business module
 * can know a country by its name.
 */
export * from './contracts';
export { allMarkets, isKnownMarket, knownMarket, marketCodes, marketFor, normalizeMarketCode } from './registry';
export { ACCOUNTING_COVERAGE, neutralMarket, type Market, type NeutralMarket } from './neutral';
export { SUPRANATIONAL_COUNTRY } from './kit/identity';
export * from './queries';
