import { AdministrativeDivision, CountryFiscalProfile } from './country-profiles';

/**
 * What the signup form is told about a country, before anyone has an account.
 *
 * The shape is deliberately explicit rather than `any`. The endpoint it comes from used to return
 * whatever a strategy's `getConfig()` happened to build — four different shapes across four
 * strategies, one of which omitted `fiscalRegionId` entirely, which the form then submitted as
 * `undefined`. A named type is what makes that class of drift a compile error.
 *
 * Nothing here is secret: it is the same information printed on the country's own tax forms.
 */
export interface PublicCountryConfig {
  countryCode: string;
  name: string;
  currency: string;
  locale: string;
  /** E.164 calling code with its leading '+', ready to render. */
  phoneCode: string;
  fiscalAuthority: string;

  taxIdLabel: string;
  taxIdExample: string;
  /** Shape check for immediate feedback. The server still re-validates arithmetically. */
  taxIdPattern: string;
  taxIdHasCheckDigit: boolean;

  /** The identifier a natural person files under, where it differs from the company one. */
  individualDocument: { code: string; label: string; pattern: string } | null;

  address: {
    divisionLabel: string;
    divisions?: AdministrativeDivision[];
    postalCodeLabel: string;
    postalCodePattern?: string;
    postalCodeRequired: boolean;
  };

  electronicInvoicing: { required: boolean; regime: string | null };

  dateFormat: string;
  thousandSeparator: string;
  decimalSeparator: string;

  /** The `fiscal_regions` row the registration payload must reference. */
  fiscalRegionId: string;
}

/**
 * The result of resolving a tax id against a country's registry.
 *
 * `valid` and `found` are separate on purpose. `valid` is the arithmetic verdict — computed here,
 * always available, and the one registration acts on. `found` says only whether a third-party
 * registry answered with a name, which is a convenience for pre-filling a form and must never
 * become a precondition for signing up: a registry outage would otherwise close the funnel.
 */
export interface TaxIdLookupResult {
  countryCode: string;
  taxId: string;
  valid: boolean;
  found: boolean;
  legalName: string | null;
  status: string | null;
}

/** Narrowing helper kept beside the type it narrows. */
export type SupportedCountrySummary = Pick<
  CountryFiscalProfile,
  'countryCode' | 'name' | 'currency' | 'callingCode'
>;
