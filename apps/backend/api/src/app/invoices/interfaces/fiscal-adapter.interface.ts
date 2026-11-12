import { EntityManager } from 'typeorm';
import type { EmissionKind } from '../../markets';
import { Invoice } from '../entities/invoice.entity';

export type { EmissionKind };

/** The fiscal identity a regime assigns to a document at the moment it is issued. */
export interface FiscalNumberAssignment {
  /**
   * The fiscal number as the document carries it, written by the market's mask; null where the
   * number is not the product's to assign (a stamp, the authority's own counter) or none exists.
   */
  fiscalNumber: string | null;
  /** The document type the number was drawn from (`E31`, `B01`, `01`, `33`…). */
  documentType: string | null;
  /** Expiry of the authorization the number belongs to, `YYYY-MM-DD`, or null. */
  expiresAt: string | null;
  /**
   * The consecutive drawn from the range, and the range's series, as drawn — recorded so nothing
   * downstream parses them back out of the formatted number. Null where no range was drawn from.
   */
  sequence: number | null;
  series: string | null;
}

/**
 * A document type one market lets a tenant issue, for the UI to offer: a row of the market's
 * catalogue (`markets/<cc>/documents.ts`). The code is the authority's own, written verbatim into
 * the document, so it is a plain string and never an enum of one authority's codes.
 */
export interface FiscalDocumentTypeOption {
  /** The authority's code, as it appears in the document: `E31`, `01`, `33`, `55`. */
  code: string;
  /** Translation key naming the type, so the UI does not carry a Spanish literal. */
  labelKey: string;
  /**
   * Whether the buyer's tax identifier is mandatory for this type.
   *
   * A Dominican E31, a Mexican CFDI with a real receptor and a Colombian factura de venta all
   * require it; a consumo document does not. The UI needs to know before the server refuses.
   */
  requiresBuyerTaxId: boolean;
  /**
   * Signed and transmitted to the authority, as opposed to a traditional document numbered from an
   * authorised range and printed. From the market's document-type catalogue
   * (`FiscalDocumentTypeSpec.isElectronic`); an adapter that leaves it out has it filled from there.
   */
  electronic?: boolean;
}

export interface FiscalAssignmentContext {
  invoice: Invoice;
  organizationId: string;
  manager: EntityManager;
  /**
   * Type explicitly requested by the caller, as the authority's own code.
   *
   * Where present the adapter honours it or refuses, by the market's rule (`MarketNumbering.
   * requestedType`): where the issuer may choose, it is how a type no rule picks by itself becomes
   * issuable (an export, a sale to the government); where the type follows from the document, a
   * request that contradicts it is refused rather than resolved silently.
   */
  requestedType?: string | null;
  /**
   * Which kind of document to issue when no type is requested, in a market whose catalogue declares
   * traditional types beside electronic ones (`MarketNumbering.emissionKinds`). Chosen by the caller
   * from the company's emission mode, its live ranges and whether it can sign
   * (`InvoicesService.issuableTypes`). Absent: the market's default.
   */
  emissionKind?: EmissionKind | null;
}


/**
 * Assigns a document its fiscal identity for one market — implemented once, by `MarketFiscalAdapter`,
 * which follows the market's declared numbering.
 *
 * The assignment is returned rather than written onto the invoice because it has several parts —
 * number, type, the authorization's expiry, and the consecutive and series it was drawn as — and an
 * authority that requires the expiry on the document (the Dominican e-CF's
 * `FechaVencimientoSecuencia`, a DIAN resolution's window) cannot be sent a number without it.
 */
export interface FiscalAdapter {
  /** Fiscal identity for a sales document. */
  assignSalesNumber(context: FiscalAssignmentContext): Promise<FiscalNumberAssignment>;

  /** Fiscal identity for a note that modifies a previously issued document. */
  assignCreditNoteNumber(
    context: FiscalAssignmentContext & { originalInvoice: Invoice },
  ): Promise<FiscalNumberAssignment>;

  /**
   * Fiscal identity for a debit note: a charge added to an issued invoice (FAC-INV-05). Absent: the
   * market's regime does not issue debit notes through this product yet, and one is refused rather
   * than numbered as something its authority would reject.
   */
  assignDebitNoteNumber?(
    context: FiscalAssignmentContext & { originalInvoice: Invoice },
  ): Promise<FiscalNumberAssignment>;

  /** The types this market lets a tenant issue on a sales document, for the UI to offer. */
  availableSalesTypes(): readonly FiscalDocumentTypeOption[];

  /**
   * Of these types, the ones the company can draw a number for today: an active authorised range
   * with numbers left and not expired. A market whose numbers are not drawn from a stored range
   * (a stamp, the authority's own counter) answers every type; one where the product issues no
   * fiscal number, none.
   */
  liveTypes(context: LiveTypesContext): Promise<ReadonlySet<string>>;

  /**
   * The types the market picks by itself, for an invoice with no type requested, in each kind
   * (`MarketNumbering.automaticTypes`). Absent: any type of that kind. A market that distinguishes a
   * sale to a taxpayer from one to a consumer picks one of those two, and never an export or a
   * government document unasked.
   */
  automaticTypes?(kind: EmissionKind): readonly string[];

  /**
   * A till receipt's fiscal number, in a market whose consumers receive the authority's receipt from
   * the till; null when the company holds no range in force for it. Absent: till sales carry their
   * commercial number only.
   */
  assignTillReceiptNumber?(context: { organizationId: string; today: string; manager: EntityManager }): Promise<FiscalNumberAssignment | null>;
}

export interface LiveTypesContext {
  organizationId: string;
  /** The candidate codes, as the adapter's `availableSalesTypes` names them. */
  codes: readonly string[];
  /** The tenant's fiscal date, `YYYY-MM-DD`. */
  today: string;
  manager: EntityManager;
}
