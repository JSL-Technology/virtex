/**
 * Who a market is: the facts every screen and every document needs before anything fiscal.
 *
 * Part of the market contract (`docs/ARQUITECTURA_MERCADOS.md`). A market's `profile.ts` answers
 * every field; nothing here may be left for a caller to default, because a default is always some
 * other country's answer.
 */

/** A first-level division, coded as the market's e-invoicing schemas require. */
export interface AdministrativeDivision {
  /** Official code as it appears in the tax authority's catalogue. */
  code: string;
  name: string;
}

/** How an address is written in the market. */
export interface MarketAddressModel {
  /**
   * What the first-level division is called locally: State, Provincia, Departamento, Região. The
   * market's own word; `fiscal.labels.*` translates the generic ones for a reader in another
   * language.
   */
  divisionLabel: string;
  /** Catalogue key of `divisionLabel` where the word is generic vocabulary (Province, State). */
  divisionLabelKey?: string;
  /** First-level divisions, where the market's e-invoicing requires a coded value. */
  divisions?: readonly AdministrativeDivision[];
  postalCodeLabel: string;
  /** Catalogue key of `postalCodeLabel` where it is generic; a local name (CEP, ZIP code) has none. */
  postalCodeLabelKey?: string;
  postalCodePattern?: string;
  postalCodeRequired: boolean;
}

/** The statutory language of a market's books and documents. */
export type BooksLanguage = 'es' | 'en' | 'pt';

/** How numbers and dates are written in the market. */
export interface MarketFormats {
  /** `dd/MM/yyyy`, `MM/dd/yyyy`, `dd-MM-yyyy`. */
  date: string;
  thousandSeparator: string;
  decimalSeparator: string;
}

/** Placeholders a form shows: the market's own shapes, never another country's. */
export interface MarketExamples {
  /** A city of the market, as written there. */
  city: string;
  /** A postal code in the market's format, or null where the market has none. */
  postalCode: string | null;
  /** A phone number in national notation. */
  phone: string;
}

export interface MarketProfile {
  /** The market's name in its own language. */
  name: string;
  /** ISO 4217 of the market's legal tender. */
  currency: string;
  /** BCP 47, for number and date formatting and for the regional wording patch. */
  locale: string;
  /**
   * The language a new company's ledger, journals and seeded names are written in. It must be the
   * language of `locale`; `market-catalogue.spec.ts` checks it.
   */
  booksLanguage: BooksLanguage;
  /**
   * IANA time zone of the market's fiscal day. A signature time, an emission date and the cut-off
   * of a monthly return are statements about local time in the issuer's country, and the server
   * runs in UTC. A market spanning several zones carries its commercial centre's; a company in
   * another one overrides it on `organizations.timezone`.
   */
  timeZone: string;
  /** E.164 calling code, without the leading '+'. */
  callingCode: string;
  /** The tax authority as it names itself: `DGII`, `SAT`, `IRS`, `Receita Federal`. */
  fiscalAuthority: string;
  address: MarketAddressModel;
  formats: MarketFormats;
  examples: MarketExamples;
  /**
   * What the product offers in the market, disclosed before payment.
   *
   *  - `available` — the market's fiscal documents are built, sealed and transmitted by the product
   *                  (the last step needs the taxpayer's own credentials, as everywhere).
   *  - `preview`   — everything else works (accounting, inventory, purchasing, payroll, reports),
   *                  and the disclosure says what does not.
   *
   * `preview` deliberately does not block signup: the customer can use the product and knows what
   * they are buying.
   */
  marketStatus: 'available' | 'preview';
}
