import type { TaxpayerKindValue } from './identity';

/**
 * The documents a market's authority defines for a sale, how each is numbered, and what may be done
 * with one once it is issued.
 */

/** Which side of the ledger a document type belongs to. */
export type FiscalDocumentSide = 'sales' | 'purchase' | 'either';

/**
 * What a document type is for.
 *
 * - `INVOICE` — a sale.
 * - `CREDIT_NOTE` — reduces or reverses an issued document.
 * - `DEBIT_NOTE` — adds a charge to an issued document.
 * - `PURCHASE_RECORD` — issued by the company as the buyer: to an informal supplier, for minor
 *   expenses, for a payment abroad. Accounts Payable's, never offered on a sale.
 */
export type DocumentPurpose = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'PURCHASE_RECORD';

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
  /**
   * What the authority publishes the type for. An authority that uses one type for several
   * purposes — the NF-e model 55 for a sale, a return and a charge; the CFDI de ingreso for a sale
   * and a charge — declares its primary one, and the market's numbering resolves the type for the
   * others (`MarketNumbering.typeOf`), in a market where the type follows from the document.
   */
  purpose: DocumentPurpose;
  /** True when the type credits a previously issued document (`purpose === 'CREDIT_NOTE'`). */
  isCreditNote: boolean;
  /** True when the buyer's tax identifier is mandatory for the type. */
  requiresBuyerTaxId: boolean;
  sortOrder: number;
}

/**
 * A document type as its market declares it: the market's code is implied, and whether it credits
 * an issued document follows from its purpose.
 */
export type MarketFiscalDocumentType = Omit<FiscalDocumentTypeSpec, 'countryCode' | 'isCreditNote'>;

/** Signed and transmitted to the authority, or numbered from an authorised range and printed. */
export type EmissionKind = 'ELECTRONIC' | 'TRADITIONAL';

/**
 * Where the fiscal number of a document comes from.
 *
 * - `AUTHORITY_RANGE` — drawn from a range the authority granted the taxpayer: the DGII's NCF, the
 *   DIAN's resolution, SUNAT's series, the SRI's emission point, the SII's CAF, the SEFAZ série.
 * - `AUTHORITY_ON_TRANSMISSION` — the authority assigns it when the document is transmitted (AFIP's
 *   next number for the point of sale). A stored counter would be a second source of truth.
 * - `STAMP` — the document's fiscal identity is the stamp the authority writes (the CFDI's UUID);
 *   there is no number to assign, only the type to record.
 * - `NONE` — the product issues no fiscal number in the market: the commercial number is the
 *   document's only one (a US invoice; a market whose authority documents are not implemented).
 */
export type FiscalNumberSource = 'AUTHORITY_RANGE' | 'AUTHORITY_ON_TRANSMISSION' | 'STAMP' | 'NONE';

/**
 * What a market's numbering is told about a document: a neutral view, no ORM entity, so the rule is
 * a function of facts and is tested without a database.
 */
export interface DocumentToNumber {
  purpose: Exclude<DocumentPurpose, 'PURCHASE_RECORD'>;
  /** The kind the issuer chose, in a market that has both. */
  emissionKind: EmissionKind | null;
  buyer: {
    /** As the document identifies the buyer. */
    taxId: string | null;
    /** The identity document recorded for the buyer (`RNC`, `RUC`, `CUIT`), when recorded. */
    documentCode: string | null;
    countryCode: string | null;
    taxpayerKind: TaxpayerKindValue | null;
    /** The buyer's market-specific fiscal data (a VAT condition), where it is recorded. */
    fiscalAttributes: Readonly<Record<string, string>> | null;
  };
  /** The issuer's fiscal data the authority required at registration (`organizations.fiscal_profile`). */
  issuerFiscalProfile: Readonly<Record<string, string>>;
  /** Whether any line of the document charges the consumption tax. */
  chargesTax: boolean;
  /** The document a note modifies. */
  original: { documentType: string | null; fiscalNumber: string | null } | null;
}

/**
 * Where a document is issued from, for a market that numbers per establishment and emission point:
 * the branch's own codes when it has them, the company's configured ones otherwise.
 */
export interface IssuingPoint {
  establishment: string | null;
  emissionPoint: string | null;
}

/**
 * Which of the company's ranges of a type a document is drawn from, where it holds several at once:
 * the one of the issuing point (`EXACT`), or one whose series begins as the market requires
 * (`PREFIX`: a Peruvian note follows the letter of the document it modifies).
 */
export type SeriesSelector = { kind: 'EXACT'; series: string } | { kind: 'PREFIX'; prefix: string };

/** A number drawn from an authorised range, before the market writes it. */
export interface DrawnSequence {
  sequence: number;
  series: string;
  documentType: string;
}

/**
 * How a market numbers its fiscal documents — the one rule the numbering engine follows for every
 * market, so no market is numbered by code written for another.
 */
export interface MarketNumbering {
  source: FiscalNumberSource;
  /** The emission kinds the market has, the default first. Empty where it has no fiscal documents. */
  emissionKinds: readonly EmissionKind[];
  /**
   * What a requested type may do.
   *
   * - `CHOOSE` — the issuer may pick any type of the purpose the document qualifies for: a Dominican
   *   export (E46) or government sale (E45), a Peruvian boleta to a buyer with a RUC.
   * - `CONFIRM` — the type follows from the document, and a request must equal it: a Chilean 33 on
   *   an exempt sale is a document the authority rejects, so the contradiction is named, not
   *   resolved silently.
   */
  requestedType: 'CHOOSE' | 'CONFIRM';
  /** The type a document is when none is requested; null where the market issues none for it. */
  typeOf(document: DocumentToNumber): string | null;
  /** The types picked automatically for a sale of each kind (DO: crédito fiscal or consumo). */
  automaticTypes?: Readonly<Partial<Record<EmissionKind, readonly string[]>>>;
  /**
   * The market numbers per establishment and emission point, so a document cannot be numbered until
   * the company has stated them (on the branch, or in its e-invoicing settings).
   */
  issuingPointRequired?: boolean;
  /**
   * The range a document is drawn from, where the series is not the company's free choice: the
   * issuing point's own (the SRI's `EEE-PPP`), or the letter the document it modifies fixes.
   * Absent, or undefined for a document: the company's active range of the type.
   */
  seriesOf?(point: IssuingPoint, document: DocumentToNumber): SeriesSelector | undefined;
  /**
   * Whether a range of this type may be registered under this series, where the authority ties one
   * to the other: a Dominican NCF has none (the type is its prefix), SUNAT's F series is a
   * factura's and its B series a boleta's, the SRI's is an establishment and an emission point.
   * Checked when the range is registered, because a range registered wrong produces documents the
   * authority refuses for every number drawn from it. Absent: any series the authority's act states.
   */
  acceptsSeries?(documentType: string, series: string): boolean;
  /** How a number drawn from a range is written on the document. */
  format?(drawn: DrawnSequence, point: IssuingPoint): string;
  /**
   * The type a till receipt is drawn as, in a market whose consumers receive the authority's receipt
   * from the till (the Dominican consumo, B02). Absent: a till sale carries its commercial number.
   */
  tillReceiptType?: string;
}

/**
 * Why a note modifies a document already issued, in the product's own terms.
 *
 * Every authority keeps its own catalogue for this — the DGII's `CodigoModificacion`, the SII's
 * código de referencia, SUNAT's catálogos 09 and 10, the DIAN's concepto de corrección — and no two
 * agree on the codes or on how finely they cut. The core stores the commercial fact, which is the
 * same everywhere; each market writes its authority's code for it (`MarketDocuments.adjustmentCodes`).
 * The invoice used to store the Dominican code itself, so a Chilean note carried a DGII number.
 *
 * A reason belongs to the kind of note it explains: a credit note reduces or reverses what was
 * invoiced, a debit note adds to it. `OTHER` carries both, with the words the issuer wrote.
 */
export const CREDIT_NOTE_REASONS = ['ANNULMENT', 'GOODS_RETURN', 'PRICE_REDUCTION', 'DETAIL_CORRECTION', 'OTHER'] as const;

/** Why a debit note adds to the document it modifies. */
export const DEBIT_NOTE_REASONS = ['LATE_PAYMENT_INTEREST', 'ADDITIONAL_CHARGES', 'PRICE_INCREASE', 'PENALTY', 'OTHER'] as const;

export type CreditNoteReason = (typeof CREDIT_NOTE_REASONS)[number];
export type DebitNoteReason = (typeof DEBIT_NOTE_REASONS)[number];
export type AdjustmentReason = CreditNoteReason | DebitNoteReason;

/** Every canonical reason, each appearing once. */
export const ADJUSTMENT_REASONS: readonly AdjustmentReason[] = Object.freeze([
  ...CREDIT_NOTE_REASONS,
  ...DEBIT_NOTE_REASONS.filter((reason): reason is Exclude<DebitNoteReason, CreditNoteReason> => !(CREDIT_NOTE_REASONS as readonly string[]).includes(reason)),
]);

/** The reasons a note of this purpose may carry. */
export function reasonsOfPurpose(purpose: 'CREDIT_NOTE' | 'DEBIT_NOTE'): readonly AdjustmentReason[] {
  return purpose === 'CREDIT_NOTE' ? CREDIT_NOTE_REASONS : DEBIT_NOTE_REASONS;
}

/**
 * The authority's own code for every canonical reason. Complete by construction: a reason with no
 * code would be a note its regime could not write, found at transmission rather than here.
 */
export type MarketAdjustmentCodes = Readonly<Record<AdjustmentReason, string>>;

/**
 * What the receiver of a document answers about it, in the product's own terms.
 *
 * Several regimes ask the receiver to answer the documents issued to them — the Dominican
 * aprobación comercial, Brazil's manifestação do destinatário, Colombia's acuse de recibo y
 * aceptación — and each codes the answer its own way. The fact is the same, so it is stored as the
 * fact and the market writes its authority's code (`MarketDocuments.counterpartyVerdictCodes`).
 */
export const COUNTERPARTY_VERDICTS = ['ACCEPTED', 'REJECTED'] as const;
export type CounterpartyVerdictValue = (typeof COUNTERPARTY_VERDICTS)[number];

/** The authority's own code for each verdict. Complete by construction, like the note reasons. */
export type MarketCounterpartyVerdictCodes = Readonly<Record<CounterpartyVerdictValue, string>>;

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
   * The authority's code for the reason a note carries. Null where the product writes none on a
   * note in this market: because the authority asks for none, or because its regime does not write
   * one yet — each market's file says which, and the coverage reports it.
   */
  adjustmentCodes: MarketAdjustmentCodes | null;
  /**
   * The authority's code for what the receiver of a document answers about it. Null where the
   * market's authority asks the receiver nothing, or where the product does not answer for them
   * yet — each market's file says which.
   */
  counterpartyVerdictCodes: MarketCounterpartyVerdictCodes | null;
  /**
   * Whether the product issues a debit note in the market: under its regime, or as the commercial
   * document a market without the authority's documents uses. False where the regime is spoken but
   * its builder does not issue the note yet — refused rather than numbered as something the
   * authority would reject.
   */
  debitNotes: boolean;
  /** The customer a sale names when it names nobody: «Consumidor final», «Público en general». */
  defaultCustomer: { nameKey: string };
  numbering: MarketNumbering;
}
