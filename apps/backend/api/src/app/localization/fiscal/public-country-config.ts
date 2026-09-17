import { AdministrativeDivision, CountryFiscalProfile, FiscalFieldSpec } from './country-profiles';

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

/**
 * One catalogue entry, as the client sees it.
 *
 * `pattern` travels for immediate feedback; the checksum algorithm's name deliberately does not.
 * The arithmetic verdict is the server's, and publishing the algorithm's name invites a client to
 * reimplement it and then disagree with the server about whether a document is valid.
 */
export interface PublicIdentityDocumentType {
  code: string;
  /** The issuing jurisdiction, or `XX` for a supranational document such as a passport. */
  countryCode: string;
  labelKey: string;
  /** Authority terminology that must render untranslated. Wins over `labelKey` when present. */
  labelVerbatim: string | null;
  example: string | null;
  pattern: string;
  requirement: 'required' | 'optional';
  appliesTo: 'individual' | 'company' | 'both';
  isDefault: boolean;
}

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

  /**
   * The identifier a natural person files under, where it differs from the company one.
   *
   * @deprecated Superseded by `identityDocumentTypes`, which is a LIST and therefore able to say
   * that Mexico issues a CURP for payroll and an RFC for invoicing, or that Colombia issues both a
   * cédula de ciudadanía and a NIT. A single optional field could say neither, which is why it was
   * populated in only two of the nineteen markets. Kept while the signup form migrates; the
   * catalogue is the source of truth and this is derived from it.
   */
  individualDocument: { code: string; label: string; pattern: string } | null;

  /**
   * Every identity document the country issues, from the catalogue.
   *
   * The signup form, the employee form, the customer form and the supplier form all read this one
   * list. Before it existed they read, respectively: a single `individualDocument`, a hardcoded
   * three-option `<select>`, nothing, and nothing — four answers to one question, of which two
   * were wrong and one did not exist.
   */
  identityDocumentTypes: readonly PublicIdentityDocumentType[];

  address: {
    divisionLabel: string;
    divisions?: AdministrativeDivision[];
    postalCodeLabel: string;
    postalCodePattern?: string;
    postalCodeRequired: boolean;
  };

  electronicInvoicing: { required: boolean; regime: string | null };

  /**
   * Whether the product can issue documents for this regime yet.
   *
   * Published so the signup form can tell the truth BEFORE payment. It previously announced
   * "México exige facturación electrónica (CFDI 4.0), por eso pedimos estos datos" for a market
   * with no adapter behind it.
   */
  marketStatus: 'available' | 'preview';

  /** Whether the form must ask company-versus-natural-person; see `TaxpayerKind`. */
  taxpayerKindRequired: boolean;

  /** The country's extra fiscal fields, rendered generically by the form. */
  fiscalFields: readonly FiscalFieldSpec[];

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
