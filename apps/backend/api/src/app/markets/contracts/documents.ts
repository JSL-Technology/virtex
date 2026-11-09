/**
 * The documents a market's authority defines for a sale, and what may be done with one once it is
 * issued.
 */

/** Which side of the ledger a document type belongs to. */
export type FiscalDocumentSide = 'sales' | 'purchase' | 'either';

/** One document type the market's authority publishes. */
export interface FiscalDocumentTypeSpec {
  /** ISO 3166-1 alpha-2 of the authority that publishes the code. */
  countryCode: string;
  /** The authority's own code, written verbatim into the document. */
  code: string;
  /** Catalogue key. `name` is a fallback, never a label. */
  labelKey: string;
  /** The authority's own name for the type, for support and for the row's `name` column. */
  name: string;
  /** Mask for the number drawn from a range of this type, where the authority fixes one. */
  sequenceFormat: string | null;
  /** True when a range of this type carries an expiry the document must state. */
  expirationRequired: boolean;
  /** True when the type is signed and transmitted to the authority. */
  isElectronic: boolean;
  side: FiscalDocumentSide;
  /** True when the type credits a previously issued document. */
  isCreditNote: boolean;
  /** True when the buyer's tax identifier is mandatory for the type. */
  requiresBuyerTaxId: boolean;
  sortOrder: number;
}

/** A document type as its market declares it: the market's code is implied. */
export type MarketFiscalDocumentType = Omit<FiscalDocumentTypeSpec, 'countryCode'>;

/**
 * How an issued sales document is cancelled.
 *
 *  - `VOID`             — the document carries no fiscal number: a commercial document the
 *                         authority never saw, voided if nothing touched it.
 *  - `REPORT`           — annulled by the issuer and declared in a periodic return, with a reason
 *                         from the authority's catalogue.
 *  - `CREDIT_NOTE_ONLY` — an issued fiscal document is never annulled: it is reversed with a credit
 *                         note.
 *  - `AUTHORITY_EVENT`  — a cancellation the authority registers, within its window and with its
 *                         reasons. No regime of the product sends that event yet, so the market is
 *                         told so and offered the credit note.
 */
export type CancellationRoute =
  | { kind: 'VOID' }
  | { kind: 'REPORT'; reasonCatalogue: 'INVOICE_CANCELLATION' }
  | { kind: 'CREDIT_NOTE_ONLY' }
  | { kind: 'AUTHORITY_EVENT'; implemented: false };

/**
 * The route a market applies to a document that carries the authority's number, by whether the
 * document's type is signed and transmitted. A document with no fiscal number is always `VOID`.
 */
export interface MarketCancellationPolicy {
  electronic: CancellationRoute;
  traditional: CancellationRoute;
}

export interface MarketDocuments {
  /**
   * The authority numbers sales documents, so the invoice shows the fiscal-document section.
   * False where invoices are numbered internally and nothing else.
   */
  fiscalNumbering: boolean;
  /** Every document type the authority publishes that the product knows, in the order offered. */
  types: readonly MarketFiscalDocumentType[];
  /**
   * How an issued document is cancelled. Null: the product has not examined the market, and a
   * fiscal document is only ever reversed with a credit note there.
   */
  cancellation: MarketCancellationPolicy | null;
  /**
   * Whether the product issues a debit note in the market: under its regime, or as the commercial
   * document a market without the authority's documents uses. False where the regime is spoken but
   * its builder does not issue the note yet — refused rather than numbered as something the
   * authority would reject.
   */
  debitNotes: boolean;
  /** The customer a sale names when it names nobody: «Consumidor final», «Público en general». */
  defaultCustomer: { nameKey: string };
}
