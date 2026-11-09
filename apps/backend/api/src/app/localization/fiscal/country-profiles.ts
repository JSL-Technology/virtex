import { allMarkets, knownMarket, marketCodes, type MarketDefinition } from '../../markets';
import type { AdministrativeDivision, FiscalFieldSpec } from '../../markets';

/**
 * The legacy flat view of a market (`CountryFiscalProfile`), derived from the market packages.
 *
 * Each market declares itself in `markets/<cc>/` (docs/ARQUITECTURA_MERCADOS.md); this file only
 * presents those declarations in the shape its consumers were written against, and goes away as they
 * read `knownMarket(cc)` directly.
 */
export type {
  AdministrativeDivision,
  FiscalFieldError,
  FiscalFieldOption,
  FiscalFieldSpec,
  TaxpayerKindValue,
} from '../../markets';
export { fiscalFieldOptionsFor, fiscalFieldsFor, normalizeFiscalFields, validateFiscalFields } from '../../markets';

export interface CountryFiscalProfile {
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  name: string;
  /** ISO 4217. */
  currency: string;
  /** BCP 47, for number and date formatting. */
  locale: string;
  /** IANA time zone of the country's fiscal day. */
  timeZone: string;
  /** E.164 calling code, without the leading '+'. */
  callingCode: string;
  fiscalAuthority: string;
  address: {
    divisionLabel: string;
    divisions?: AdministrativeDivision[];
    postalCodeLabel: string;
    postalCodePattern?: string;
    postalCodeRequired: boolean;
  };
  /** Whether the country mandates electronic invoicing, and which regime. */
  electronicInvoicing: { required: boolean; regime: string | null };
  marketStatus: 'available' | 'preview';
  fiscalFields?: readonly FiscalFieldSpec[];
  requiredFiscalReports?: string[];
  serviceChargeRate?: number;
  dateFormat: string;
  thousandSeparator: string;
  decimalSeparator: string;
}

function legacyProfile(market: MarketDefinition): CountryFiscalProfile {
  const { profile } = market;
  const address = profile.address;
  return {
    countryCode: market.code,
    name: profile.name,
    currency: profile.currency,
    locale: profile.locale,
    timeZone: profile.timeZone,
    callingCode: profile.callingCode,
    fiscalAuthority: profile.fiscalAuthority,
    address: {
      divisionLabel: address.divisionLabel,
      ...(address.divisions ? { divisions: [...address.divisions] } : {}),
      postalCodeLabel: address.postalCodeLabel,
      ...(address.postalCodePattern !== undefined ? { postalCodePattern: address.postalCodePattern } : {}),
      postalCodeRequired: address.postalCodeRequired,
    },
    electronicInvoicing: { required: market.einvoicing.required, regime: market.einvoicing.regime },
    marketStatus: profile.marketStatus,
    ...(market.identity.fiscalFields.length ? { fiscalFields: market.identity.fiscalFields } : {}),
    ...(market.returns.obligations.length ? { requiredFiscalReports: [...market.returns.obligations] } : {}),
    ...(market.taxes.serviceChargeRate > 0 ? { serviceChargeRate: market.taxes.serviceChargeRate } : {}),
    dateFormat: profile.formats.date,
    thousandSeparator: profile.formats.thousandSeparator,
    decimalSeparator: profile.formats.decimalSeparator,
  };
}

/** Every market, in the order they are offered. */
export const COUNTRY_FISCAL_PROFILES: readonly CountryFiscalProfile[] = allMarkets().map(legacyProfile);

const BY_CODE = new Map(COUNTRY_FISCAL_PROFILES.map((p) => [p.countryCode, p]));

/**
 * The name of a first-level division from its code — `('DO', '32')` → «Santo Domingo» — or null when
 * the market codes none or the code is unknown.
 */
export function divisionName(countryCode: string | null | undefined, code: string | null | undefined): string | null {
  if (!countryCode || !code) return null;
  const divisions = knownMarket(countryCode)?.profile.address.divisions;
  return divisions?.find((d) => d.code === code.trim().toUpperCase())?.name ?? null;
}

export function findCountryProfile(countryCode: string): CountryFiscalProfile | undefined {
  return BY_CODE.get(countryCode?.toUpperCase() ?? '');
}

export function supportedCountryCodes(): string[] {
  return [...marketCodes()];
}

/** The market's legal service charge as a fraction. Zero where none applies or the market is unknown. */
export function serviceChargeRateFor(countryCode: string | null | undefined): number {
  return knownMarket(countryCode)?.taxes.serviceChargeRate ?? 0;
}
