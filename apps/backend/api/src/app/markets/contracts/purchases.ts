/**
 * What a supplier's document is in a market, and how a purchase is recorded for its authority.
 */

/** The outcome of checking the number on a supplier's document. */
export interface ReceivedDocumentCheck {
  /**
   * `unverified` is an honest answer, not a failure: the market's number has no published shape the
   * product checks, so it is kept as written and the person is told it was not verified.
   */
  status: 'ok' | 'missing' | 'invalid' | 'unverified';
  /** Which number the market's documents carry (see {@link MarketReceivedDocument.kind}). */
  kind: string;
  normalized: string | null;
  /** The authority's document type, where the number encodes one. */
  type: string | null;
  /** Why the number was refused: `format`, `check_digit`, or a reason the market's rule names. */
  error: string | null;
  /** What is unusual but can be right, in the market rule's own terms. */
  warnings: string[];
}

/**
 * The number on a supplier's document. A Dominican bill carries an NCF the DGII assigned, a
 * Mexican one the CFDI folio fiscal, a Brazilian one the 44-digit NF-e access key; a US bill only
 * the supplier's own invoice number, which no authority checks.
 */
export interface MarketReceivedDocument {
  /**
   * A stable name for what the number is: `NCF`, `CFDI_UUID`, `NFE_KEY`, `CUFE`, `FISCAL_NUMBER`,
   * `INVOICE_NUMBER`. Opaque to the core: it is recorded and shown, never branched on.
   */
  kind: string;
  /** Catalogue key of the number's label on purchase forms. */
  labelKey: string;
  /** What the number is, in English, for a reader of the document (a person, or a model). */
  description: string;
  /** The market's own rule. Total: any input, including nonsense, gets an answer. */
  check(raw: string): ReceivedDocumentCheck;
}

export interface MarketPurchases {
  /**
   * A purchase must record the supplier's authority-issued document number, in the authority's
   * shape. False: the supplier's own invoice number is enough.
   */
  supplierFiscalNumber: boolean;
  /** Purchases are classified for an authority report. */
  purchaseClassification: boolean;
  receivedDocument: MarketReceivedDocument;
}
