/**
 * What a market declares about itself, as both halves of the product read it.
 *
 * ## Why this exists
 *
 * A United States company used to receive a Dominican product (QA C-06): the payment methods screen
 * said the DGII fixed them, the invoice offered «Withholding at source» and a «Designated withholding
 * agent», the fiscal returns page described the DGII formats, and the default customer was
 * «Consumidor final». None of it was a decision anybody made for the United States — each screen had
 * been written for the first market and nothing told it otherwise.
 *
 * The answer is not an `if (country === 'DO')` in each screen; it is one declaration per market of
 * what that market has, read by every screen that needs to know. The server builds it (see
 * `apps/backend/api/src/app/contracts/country-pack`) and serves the public half at
 * `GET /localization/country-pack`; this file is the shape both sides compile against, so a field the
 * server stops sending is a compile error in the client rather than a screen that quietly falls back
 * to the Dominican behaviour.
 *
 * Only capabilities and presentation travel here. The seeds a market provisions with — its payment
 * methods, payroll parameters and concepts — stay on the server.
 */

/** How a market's consumption tax is expressed. */
export type CountryTaxModel =
  /** A national rate table (ITBIS, IVA, IGV): the tenant's tax catalogue holds the rates. */
  | 'NATIONAL_RATES'
  /**
   * No national rate: the rate is the sum of the jurisdictions the sale is sourced to (US sales tax,
   * Brazil's ICMS/ISS). The tenant registers the jurisdictions where it collects.
   */
  | 'BY_JURISDICTION';

/** Whether the tenant may shape its payment-method catalogue. */
export type PaymentMethodCatalogue =
  /** The tax authority fixes the list and its codes (DGII's 606 «Forma de pago»). Read-only. */
  | 'AUTHORITY_FIXED'
  /** The tenant adds, renames and retires methods; the seeded ones are only a starting point. */
  | 'EDITABLE';

/** Which periodic-return generator the product has for a market, if any. */
export type FiscalReturnGenerator = 'DGII' | 'SAT';

/** A report a tenant can prepare its returns with, where the product generates no file for them. */
export interface CountryPackReportLink {
  /** Catalogue key of the report's name. */
  labelKey: string;
  /** Absolute application route (pages mount in tabs, so links must be absolute). */
  route: string;
}

/** Examples a form shows as placeholders: the market's own shapes, never another country's. */
export interface CountryPackExamples {
  /** A city of the market, as written there. */
  city: string;
  /** A postal code in the market's format, or null where the market has none. */
  postalCode: string | null;
  /** A phone number in national notation. */
  phone: string;
}

export interface PublicCountryPack {
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: string;

  /** The tax authority as it names itself (`DGII`, `SAT`, `IRS`), or null. */
  fiscalAuthority: string | null;

  documents: {
    /**
     * The authority numbers sales documents (NCF/e-NCF, CFDI folio, CAE…), so the invoice shows the
     * fiscal-document section. False where invoices are numbered internally and nothing else.
     */
    fiscalNumbering: boolean;
    /**
     * A purchase must record the supplier's authority-issued document number, in the authority's
     * shape (the NCF a 606 line is reported under). False: the supplier's own invoice number.
     */
    supplierFiscalNumber: boolean;
    /** Catalogue key for the supplier document number's label on purchases. */
    supplierDocumentNumberKey: string;
    /** Purchases are classified for an authority report (DGII 606 «Tipo de bienes y servicios»). */
    purchaseClassification: boolean;
  };

  /**
   * Withholding at source exists in this market: the buyer may withhold part of the tax or of the
   * price and remit it on the seller's behalf. Drives the withholding fields of invoices and bills
   * and the taxpayer classification of customers and suppliers.
   */
  withholding: { applies: boolean };

  taxes: {
    model: CountryTaxModel;
    /** Catalogue key of the tax's generic name in this market («Sales tax», «IVA»…). */
    nameKey: string;
  };

  paymentMethods: {
    catalogue: PaymentMethodCatalogue;
    /** Whose catalogue it is when fixed («DGII»), for the screen to say so. */
    authority: string | null;
  };

  payroll: {
    /**
     * Who keeps the statutory rates: the platform, for a market whose rules the payroll engine
     * computes, or the company itself, for one whose rates it records as editable defaults.
     */
    statutoryParameters: 'PLATFORM' | 'COMPANY';
  };

  fiscalReturns: {
    /** The generator the product has, or null where it produces no return files for the market. */
    generator: FiscalReturnGenerator | null;
    /** Day of the following month a monthly return falls due, where the product knows it. */
    dueDay: number | null;
    /** The reports to prepare the returns with where there is no generator. */
    prepareWith: CountryPackReportLink[];
  };

  examples: CountryPackExamples;
}

/** First-level division of a market, as the country pack endpoint lists it. */
export interface CountryPackDivision {
  code: string;
  name: string;
}

/** The answer of `GET /localization/country-pack`: the tenant's pack and its address divisions. */
export interface TenantCountryPackResponse extends PublicCountryPack {
  /** What the first-level division is called there (State, Provincia…), verbatim. */
  divisionLabel: string | null;
  divisions: CountryPackDivision[];
}
