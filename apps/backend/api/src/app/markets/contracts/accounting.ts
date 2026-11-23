/**
 * What a market adds to, or requires of, the starting chart of accounts.
 *
 * The plan itself — an IFRS structure written in the market's books language — is built by the
 * chart-of-accounts engine, the same for every market. A market declares only what is its own:
 * the institutions its payroll is remitted to, the name of its excise tax and service charge, the
 * authority's grouping codes, and whether its law prescribes an official plan instead.
 */

/** One segment of an account code. */
export interface CoaSegmentSpec {
  name: string;
  length: number;
  isRequired: boolean;
}

/** Payroll liability and expense account names, in the market's own institutions. */
export interface PayrollAccountNames {
  pension: string;
  health: string;
  otherContributions: string;
  incomeTaxWithheld: string;
  employerContributions: string;
}

export interface MarketAccounting {
  /**
   * The official plan the market's law prescribes, where it does (Colombia's PUC, Peru's PCGE),
   * named so the gap is visible: the starting plan does not reproduce it. Null where none is
   * required.
   */
  statutoryPlanRequired: string | null;
  /** The account-code structure, where the market's plan uses another shape than the default. */
  segments: readonly CoaSegmentSpec[] | null;
  /** Payroll accounts named after the market's institutions; the neutral names otherwise. */
  payrollAccounts: Partial<PayrollAccountNames> | null;
  /** The excise tax account, under the market's own name for the tax (ISC, IEPS, ICE, INC). */
  exciseTaxAccount: string | null;
  /** The legal service charge account, for a market whose taxes declare a service charge. */
  serviceChargeAccount: string | null;
  /** The authority's grouping code per template account code (Mexico's «código agrupador»). */
  fiscalGroupingCodes: Readonly<Record<string, string>> | null;
  /**
   * Names in the plan that belong to this market's institutions only. A plan provisioned for any
   * other market must contain none of them; tests assert it, which is what keeps one market's
   * vocabulary from becoming everyone's default again.
   */
  exclusiveTerms: readonly RegExp[];
  /**
   * How the market's books recognise inflation, for a market whose economy calls for restated
   * statements (IAS 29). Null where none is required.
   */
  inflationAccounting: MarketInflationAccounting | null;
  /**
   * Who publishes the exchange rate this market's books and taxes take as official, and how the
   * product reads it (audit 2026-11-07, FINB-03). Null where the market's currency is the dollar and
   * nothing it books in needs a published conversion of its own.
   */
  officialExchangeRates: MarketOfficialExchangeRates | null;
  /**
   * How the market's tax law depreciates fixed assets: the categories its authority fixes and the
   * rate of each (audit 2026-11-07, FINB-16). The tax book of an asset starts from its category.
   * Null where the law states no categories the product carries — a company then sets the rate of
   * each of its own categories.
   */
  taxDepreciation: MarketTaxDepreciation | null;
}

/**
 * One category a tax authority depreciates assets in, at the rate it fixes — a starting point a
 * local accountant confirms.
 */
export interface MarketTaxDepreciationCategory {
  /** Stable across releases: what a company's category names it by. `DO-2`. */
  code: string;
  /** The catalogue key of its name, read in the reader's language. */
  nameKey: string;
  /** `STRAIGHT_LINE` on the cost; `DECLINING_BALANCE` on what is left at the start of each year. */
  method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE';
  /** The yearly rate, as a fraction: 0.25 for 25 %. */
  annualRate: number;
  /** The provision it comes from. */
  legalBasis: string;
}

/** A market's tax depreciation: its authority, its categories, and what the product does not model. */
export interface MarketTaxDepreciation {
  authority: string;
  categories: readonly MarketTaxDepreciationCategory[];
  /** What of the rule the per-asset book does not reproduce, said where it is used. */
  caveat: string;
}

/**
 * A market's official exchange rate: a publication, by an institution, that the market's
 * accounting and tax rules name as the rate to convert at.
 *
 * Declared per market because it is a fact about the market. The figures are reference data: the
 * feed below writes them to the shared rate table as `OFFICIAL`, under its own code as the source,
 * where every company booking in the market's currency resolves them — or, where there is no feed
 * yet, a company records or imports them itself (`tenant_exchange_rates`).
 */
export interface MarketOfficialExchangeRates {
  /** The institution, as it names itself. */
  readonly publisher: string;
  /** The market's currency, which the published rates are quoted in. */
  readonly quoteCurrency: string;
  /** What makes the publication official for books and taxes, as an accountant would cite it. */
  readonly legalBasis: string;
  /** How the product reads it automatically, or null where it does not yet. */
  readonly feed: OfficialRateFeed | null;
}

/** One published figure, as the publication states it. */
export interface OfficialRateQuote {
  /** The foreign currency quoted, ISO 4217. */
  readonly currency: string;
  /** The day the publication dates the figure, `YYYY-MM-DD`. */
  readonly publishedOn: string;
  /** Units of the market's currency per unit of `currency`. */
  readonly rate: number;
}

/**
 * The publication changed shape, or answered with something that is not it. A feed never guesses a
 * figure out of a response it does not recognise: the run fails, names what was wrong, and nothing
 * is written.
 */
export class OfficialRateFormatError extends Error {
  constructor(readonly feed: string, readonly reason: string) {
    super(`${feed}: ${reason}`);
    this.name = 'OfficialRateFormatError';
  }
}

/**
 * How the product reads one publication: where to ask, and how to read the answer.
 *
 * Both are pure — the HTTP call, the external-effects switch, the credential and the storage are the
 * platform's (`currencies/official-rates.service.ts`) — so a feed is tested against recorded
 * documents and never needs the network.
 */
export interface OfficialRateFeed {
  /** Stable code the rates are stored under (`exchange_rate.source`): `<country>-<publication>`. */
  readonly code: string;
  readonly country: string;
  /** The publication, in the publisher's own words. */
  readonly publication: string;
  /** The foreign currencies it quotes, each against the market's currency. */
  readonly currencies: readonly string[];
  /**
   * The day a published figure is the official rate FOR: the day it is dated, or the day after —
   * Mexico's contributions use the rate the DOF published the day before (CFF art. 20).
   */
  readonly effectiveFrom: 'publication-day' | 'day-after-publication';
  /** When the day's figure is out, in the publisher's time zone; the job looks for it after this. */
  readonly publishedAfter: { readonly timeZone: string; readonly time: string };
  /**
   * How many days past today the publication may already date a figure: Colombia's TRM is certified
   * the afternoon before the day it applies to — on Friday for the whole weekend — so tomorrow's is
   * read today. Zero for a publication that only ever dates the day it is out.
   */
  readonly datesAhead: number;
  /**
   * The largest day-on-day move written without an operator confirming it, as a fraction (0.1 =
   * 10 %). Null for a currency that moves too much for a bound to mean anything.
   */
  readonly maxDailyChange: number | null;
  /** The environment variable holding the credential the publisher requires, where it requires one. */
  readonly credentialEnv: string | null;
  /**
   * Where the format the parser reads was established. A feed whose format comes from the
   * publisher's documentation starts in shadow — it fetches and compares, and writes nothing — until
   * an operator has seen it read the live publication correctly.
   */
  readonly formatEstablishedFrom: 'documentation' | 'live-response';
  /** The request for the days `from`..`to` (inclusive). */
  request(range: { readonly from: string; readonly to: string }, credential: string | null): {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
  };
  /** The figures in a response body. Throws `OfficialRateFormatError` on anything it does not recognise. */
  parse(body: string): OfficialRateQuote[];
}

/**
 * A general price index a market's profession prescribes for restating its statements.
 *
 * A fact about the market, so it is declared here; its monthly values are reference data in the
 * database (`price_index_values`, versioned by revision), loaded by the platform from the official
 * publication or recorded by a company for itself (`tenant_price_index_values`).
 */
export interface PriceIndexSeriesDefinition {
  /** Stable code the values are stored under: `<country>-<series>`. */
  code: string;
  country: string;
  /** The currency whose purchasing power it measures: a restatement only applies to books kept in it. */
  currency: string;
  /** The official name, as the publisher writes it. */
  name: string;
  publisher: string;
  /** The instrument that prescribes the series for restating statements. */
  legalBasis: string;
}

/** An account the market keeps at nominal value, with its restatement in an account of its own. */
export interface MarketRestatementAccount {
  /** The template code of the account kept at nominal value (capital). */
  sourceCode: string;
  /** The template code of the account that takes its restatement. */
  code: string;
  /** Its name, in the market's books language. */
  name: string;
}

export interface MarketInflationAccounting {
  readonly series: PriceIndexSeriesDefinition;
  /** The standard that requires restated statements, as an accountant would cite it. */
  readonly standard: string;
  /** What a company of the market starts with (`InflationAdjustmentPolicy`). */
  readonly defaultPolicy: 'YEAR_END' | 'EVERY_PERIOD';
  readonly restatementAccounts: readonly MarketRestatementAccount[];
}
