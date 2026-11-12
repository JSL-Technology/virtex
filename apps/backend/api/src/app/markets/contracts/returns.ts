import type { CapabilityCoverage } from './coverage';

/**
 * The periodic returns a market's authority requires, and how the product helps file them.
 *
 * ## Why a market builds its own returns
 *
 * A return is the least portable thing an authority publishes: the DGII's 606 has twenty-three
 * pipe-delimited boxes in a fixed order, the SAT's balanza is an XSD-validated XML of accounts with
 * its own grouping codes, and no two agree on what a period even is. The product cannot have a
 * generic generator; what it can have is a generic ENGINE — one that knows how to assemble a
 * period's facts and nothing about any authority — and a generator per market that turns those
 * facts into its authority's file.
 *
 * So: the core owns `ReturnDataset` (what happened in the period, as plain data) and each market
 * owns its `MarketReturnFiling[]` (what its authority receives, and how). The Dominican returns
 * used to live in the sales module reading `Repository<Invoice>` directly, which is why a Mexican
 * tenant could ask for a 607 and why adding Peru's or Chile's returns meant editing that module
 * (docs/ARQUITECTURA_MERCADOS.md, fase 5).
 */

/** A report a tenant can prepare its returns with, where the product generates no file for them. */
export interface ReturnPreparationReport {
  /** Catalogue key of the report's name. */
  labelKey: string;
  /** Absolute application route (pages mount in tabs, so links must be absolute). */
  route: string;
}

/** The period a return covers, in the filer's own fiscal time zone. */
export interface ReturnPeriod {
  /** Four digits. */
  year: number;
  /** 1–12. */
  month: number;
  /** First day of the period, `YYYY-MM-DD`. */
  from: string;
  /** Last day of the period, `YYYY-MM-DD`. */
  to: string;
}

/** Who is filing, as every return states it. */
export interface ReturnFiler {
  /** Digits and letters as recorded; a market writes it in the form its authority reads. */
  taxId: string;
  legalName: string;
  /** ISO 3166-1 alpha-2 of the market whose authority receives the filing. */
  country: string;
  /**
   * What this market asked the company to declare about itself (`organizations.fiscal_profile`):
   * the Dominican «tipo de ingreso», a Mexican régimen fiscal, an Argentine condición de IVA.
   */
  fiscalProfile: Readonly<Record<string, string>>;
}

/**
 * How a document was settled, split across the methods the product records.
 *
 * Several returns ask for the amount per method rather than for a method: the Dominican 607 has a
 * column for each. A product that records one method per document puts the whole amount in that
 * column, and the others are zero — which is not the same as absent, because the record is
 * positional.
 */
export interface ReturnSettlement {
  cash: number;
  transfer: number;
  card: number;
  credit: number;
  giftCard: number;
  swap: number;
  other: number;
}

/** One document the company ISSUED in the period, with every figure a return reports. */
export interface ReturnSalesRecord {
  /** The number the authority gave it. Documents without one are not in the dataset. */
  fiscalNumber: string;
  /** Its type, as the market's own catalogue names it (`E31`, `B02`, `I`). */
  documentType: string | null;
  /** `YYYY-MM-DD`. */
  issueDate: string;
  /** Who it was issued to, as recorded on the document itself. */
  counterpartyTaxId: string | null;
  counterpartyName: string | null;
  /** The number of the document this one modifies, where it modifies one. */
  modifiedFiscalNumber: string | null;
  /** What was invoiced before tax, net of discounts. */
  netAmount: number;
  taxAmount: number;
  exciseAmount: number;
  otherTaxes: number;
  /** A legally tipped service charge, where the market has one. */
  serviceCharge: number;
  total: number;
  /** What the counterparty withheld when they paid, and the date of the latest such receipt. */
  taxWithheld: number;
  incomeTaxWithheld: number;
  withheldOn: string | null;
  settlement: ReturnSettlement;
  /**
   * Annulled: the number was assigned and then voided, which several authorities require to be
   * declared so the gap in the sequence is explained. A document a credit note reversed is NOT
   * annulled — it was a sale of its period and its note reports the reversal.
   */
  annulled: boolean;
  /** The authority's own code for why, where it was recorded with one. */
  annulmentCode: string | null;
  /** The words whoever voided it wrote, for a market that derives the code from them. */
  annulmentReason: string | null;
  /** Where it was issued: a document screen or a till. */
  origin: 'DOCUMENT' | 'TILL';
}

/** One document the company RECEIVED in the period, as its purchases return reports it. */
export interface ReturnPurchaseRecord {
  kind: 'bill' | 'credit_note';
  /** The product's own number for it, to name it in a refusal a person must act on. */
  reference: string;
  supplierName: string | null;
  supplierTaxId: string | null;
  /** ISO 3166-1 alpha-2 where the supplier is established; null when not recorded. */
  supplierCountry: string | null;
  fiscalNumber: string | null;
  /** The comprobante this one modifies: a credit note's bill. */
  modifiedFiscalNumber: string | null;
  date: string;
  paidOn: string | null;
  /**
   * What this market asked about the purchase, by the keys it declares
   * (`MarketPurchases.fiscalAttributes`): the kind of goods or services, the kind of withholding.
   */
  fiscalAttributes: Readonly<Record<string, string>>;
  /** The authority's code for how it was paid; null where the market publishes no catalogue. */
  paymentFiscalCode: string | null;
  servicesAmount: number;
  goodsAmount: number;
  taxAmount: number;
  taxWithheld: number;
  taxProportional: number;
  taxToCost: number;
  incomeTaxWithheld: number;
  exciseAmount: number;
  otherTaxes: number;
  serviceCharge: number;
  total: number;
}

/** One account of the chart, with the period's movement, as a bookkeeping return reports it. */
export interface ReturnAccountRecord {
  code: string;
  /** The account's name in the books' own language. */
  name: string;
  /** `DEBIT` when its increases are debits. */
  nature: 'DEBIT' | 'CREDIT';
  /**
   * The code this account is mapped onto in the authority's published grouping list, where the
   * market has one (the SAT's `CodAgrup`); null when the company has not mapped it.
   */
  groupingCode: string | null;
  /** Signed `debit − credit`, as the ledger stores it: a market writes it in its own sense. */
  openingBalance: number;
  debit: number;
  credit: number;
  closingBalance: number;
}

/** One posted journal entry of the period, with its lines. */
export interface ReturnJournalRecord {
  /** The entry's own number: gap-free per journal and fiscal year, as the ledger allocates it. */
  number: string;
  /** `YYYY-MM-DD`. */
  date: string;
  description: string;
  lines: readonly ReturnJournalLine[];
}

export interface ReturnJournalLine {
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

/**
 * What happened in the period, as plain data, for a market's generator to read.
 *
 * Each part is asked for when it is read, so a filing pays only for what it declares: the 606 never
 * loads a journal entry and the balanza never loads an invoice. Implemented by the core
 * (`compliance/returns/`), which is the only side that knows where any of it is stored.
 */
export interface ReturnDataset {
  readonly filer: ReturnFiler;
  readonly period: ReturnPeriod;
  /** Every document issued in the period that carries a fiscal number, in date order. */
  sales(): Promise<readonly ReturnSalesRecord[]>;
  /** Every supplier comprobante received in the period, in date order. */
  purchases(): Promise<readonly ReturnPurchaseRecord[]>;
  /** The period's bills from suppliers established outside the filer's own country. */
  foreignPurchases(): Promise<readonly ReturnPurchaseRecord[]>;
  /** The chart of accounts with the period's movement, in code order. */
  accounts(): Promise<readonly ReturnAccountRecord[]>;
  /** The period's posted entries with their lines, in date and number order. */
  journals(): Promise<readonly ReturnJournalRecord[]>;
}

/** Something an authority asks for beyond the period. */
export interface MarketReturnOption {
  /** The authority's own name for it: `tipoEnvio`, `numOrden`. */
  name: string;
  labelKey: string;
  /** `CHOICE` is checked against `values`; `DATE` must be `YYYY-MM-DD`. */
  kind: 'TEXT' | 'DATE' | 'CHOICE';
  values?: readonly string[];
  /** Required for every filing of this kind. A rule that depends on another option is the generator's. */
  required?: boolean;
}

/**
 * Why a return cannot be filed, in this market's own words.
 *
 * Returned rather than thrown: a market package does not depend on the product's i18n or HTTP
 * layers, so it names the message and the engine raises it. Refusing is the point — a Dominican 606
 * filed with a purchase nobody classified, or a supplier without a tax id, is rejected whole by the
 * DGII, and discovering that at the upload on the deadline is worse than being told here.
 */
export interface ReturnRefusal {
  /** Catalogue key of the message. */
  messageKey: string;
  /** The values the message names. */
  params?: Readonly<Record<string, string | number>>;
}

/** What a generator produces: the file and how many records it declares, or why it cannot. */
export type MarketReturnResult =
  | { readonly file: string; readonly records: number; readonly refusal?: undefined }
  | { readonly refusal: ReturnRefusal; readonly file?: undefined };

/** One filing a market's authority receives, and how the product produces it. */
export interface MarketReturnFiling {
  /** The authority's own name for it: `606`, `balanza`. Unique within the market. */
  code: string;
  labelKey: string;
  /**
   * `MONTHLY` for a filing with a deadline every month; `ON_REQUEST` for one the authority asks
   * for when it audits, refunds or offsets — tracking that as monthly would show eleven months
   * «not filed» that were never due.
   */
  periodicity: 'MONTHLY' | 'ON_REQUEST';
  /** What the file is, for the download: `text/plain`, `application/xml`. */
  mediaType: string;
  /** Its extension, without the dot. */
  extension: string;
  /** Whether the filing calendar tracks it month by month. */
  tracked: boolean;
  /** What the authority asks for beyond the period, checked by the engine before the build. */
  options?: readonly MarketReturnOption[];
  /** The file itself, from the period's facts. */
  build(
    dataset: ReturnDataset,
    options: Readonly<Record<string, string>>,
  ): Promise<MarketReturnResult> | MarketReturnResult;
  /** What the file is called when it is downloaded. */
  fileName(period: ReturnPeriod): string;
}

export interface MarketReturns {
  /**
   * The return generator the product has for the market, by the name the client knows it under,
   * or null where it produces no return files there.
   */
  generator: string | null;
  /** Day of the following month a monthly return falls due, where the product knows it. */
  dueDay: number | null;
  /** The reports to prepare the returns with where there is no generator. */
  prepareWith: readonly ReturnPreparationReport[];
  /**
   * The periodic filings the authority requires, by their official name. Only populated where the
   * obligation is named and specific; an empty list means "not modelled", never "none".
   */
  obligations: readonly string[];
  /** The files the product generates for this market, each from the period's own facts. */
  filings: readonly MarketReturnFiling[];
  /** What the product generates and what it does not, as coverage lines. */
  coverage: readonly CapabilityCoverage[];
}
