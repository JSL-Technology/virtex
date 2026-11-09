import type { CoverageLine } from './coverage';

/**
 * How a market taxes a sale: its consumption taxes, whether a buyer withholds, and the legal
 * service charge where one exists.
 */

/** How a market's consumption tax is expressed. */
export type MarketTaxModel =
  /** A national rate table (ITBIS, IVA, IGV): the tenant's tax catalogue holds the rates. */
  | 'NATIONAL_RATES'
  /** No national rate: the rate is the sum of the jurisdictions the sale is sourced to. */
  | 'BY_JURISDICTION';

/** How a tax amount is computed. The taxes module maps it onto `taxes.type`. */
export type TaxComputation = 'PERCENTAGE' | 'FIXED';

/** A consumption tax a new company starts with. */
export interface MarketTax {
  /** Shown in the tenant's tax list, in the market's own terminology. */
  name: string;
  /** Percentage points. `18` means 18 %. */
  rate: number;
  computation: TaxComputation;
  /** What the tax is: VAT, sales tax, excise. Descriptive; never written to an enum column. */
  regime: string;
}

export interface MarketTaxScheme {
  taxes: readonly MarketTax[];
  /**
   * True when the market's tax base cannot be expressed as a national rate and the tenant must
   * configure it during onboarding. A zero-rate placeholder would be worse than nothing: it looks
   * configured.
   */
  configurationRequired: boolean;
  /** Shown to the tenant when `configurationRequired`; says precisely what is missing. */
  configurationNote?: string;
  /**
   * Whether a sale into a jurisdiction where the seller is not registered carries no tax. True
   * only where that is the law (a seller without nexus collects nothing); everywhere else an
   * unconfigured jurisdiction blocks issuing instead of producing a zero.
   */
  noRegistrationMeansNoTax?: boolean;
}

/** What a withholding is levied on. */
export type WithholdingKind =
  /** A share of the output consumption tax on the document. */
  | 'VAT'
  /** A share of the taxable base, on account of the seller's income tax. */
  | 'INCOME';

/**
 * A party's fiscal classification — the fact that decides whether a buyer withholds and at what
 * rate. Assigned by the tax authority, not inferred by the product: a company is a designated
 * withholding agent because it appears on the authority's list, and nothing on the customer record
 * can establish that. Recorded on customers, suppliers and the tenant's own settings.
 */
export enum TaxpayerType {
  /** A natural person, not registered as a business. */
  INDIVIDUAL = 'INDIVIDUAL',
  /** A company, ordinary regime. */
  COMPANY = 'COMPANY',
  /**
   * A taxpayer the authority has designated a withholding agent. The designation is published; it is
   * not derived from size.
   */
  WITHHOLDING_AGENT = 'WITHHOLDING_AGENT',
  /** The State and its dependencies, which withhold on their own account. */
  GOVERNMENT = 'GOVERNMENT',
  /** A party outside the country. Exports are generally zero-rated and nothing is withheld here. */
  FOREIGN = 'FOREIGN',
}

/** {@link TaxpayerType} as its string values, for market data. */
export type WithholdingPartyType = `${TaxpayerType}`;

/** What is being sold, which several regimes distinguish. */
export type WithholdingScope = 'SERVICES' | 'GOODS' | 'ANY';

export interface MarketWithholdingRegime {
  /** Stable identifier recorded on the document, so a filing can be traced to the rule applied. */
  code: string;
  kind: WithholdingKind;
  /** As a fraction: of the output tax for `VAT`, of the taxable base for `INCOME`. */
  rate: number;
  payers: readonly WithholdingPartyType[];
  /** The seller classifications it applies to. Absent means any. */
  payees?: readonly WithholdingPartyType[];
  scope: WithholdingScope;
  /** What the tenant sees, in the market's own terminology. */
  label: string;
  /** The instrument that establishes it, so an advisor can confirm it in one lookup. */
  legalBasis: string;
  /** The period the regime applies in. Open bounds are null. */
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface MarketWithholding {
  /**
   * Withholding at source exists in the market: the buyer may withhold part of the tax or of the
   * price and remit it for the seller. Drives the withholding fields of invoices and bills and the
   * taxpayer classification of customers and suppliers.
   */
  applies: boolean;
  regimes: readonly MarketWithholdingRegime[];
  /**
   * True when the market's withholding cannot be expressed as a national table, so nothing is
   * applied until the tenant configures its own regimes.
   */
  configurationRequired: boolean;
  /** Shown when `configurationRequired`, naming precisely what has to be set up. */
  configurationNote?: string;
}

export interface MarketTaxes {
  model: MarketTaxModel;
  /** Catalogue key of the tax's generic name in the market («Sales tax», «IVA»…). */
  nameKey: string;
  /**
   * The name of the principal consumption tax, as the ledger names its accounts: «ITBIS», «IVA»,
   * «Sales Tax», «Tributos». Declared even where no tax is seeded.
   */
  principalTaxName: string;
  scheme: MarketTaxScheme;
  withholding: MarketWithholding;
  /**
   * The legal service charge the market levies on hospitality sales, as a fraction; zero where it
   * levies none.
   */
  serviceChargeRate: number;
  coverage: {
    /** Whether the product determines the market's tax on a sale. */
    taxDetermination: CoverageLine;
    /** Whether the product applies the market's withholding. */
    withholding: CoverageLine;
  };
}
