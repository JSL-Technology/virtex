import { EntityManager } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';

/** The fiscal identity a regime assigns to a document at the moment it is issued. */
export interface FiscalNumberAssignment {
  /** The fiscal number itself, or null in a regime that issues none. */
  ncf: string | null;
  /** The document type the number was drawn from (`E31`, `B01`, `01`, `33`…). */
  documentType: string | null;
  /** Expiry of the authorization the number belongs to, `YYYY-MM-DD`, or null. */
  expiresAt: string | null;
}

/**
 * A document type one market lets a tenant issue, for the UI to offer.
 *
 * This used to be `readonly NcfType[]` — the DGII's own enum — and the audit's H18 is partly about
 * what that costs: a Mexican, Colombian or Chilean tenant has document types too (`I` ingreso,
 * factura electrónica de venta, DTE 33 afecta / 34 exenta), and none of them is expressible as an
 * `NcfType`. An interface that can only describe one country's codes is an interface that resolves
 * every other country to the generic adapter, which is exactly what it did.
 *
 * The code stays a plain string because it is the authority's own code and is written verbatim into
 * the document; the enum survives as the Dominican adapter's source for its own values.
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
   * Where present the adapter must honour it or refuse — it is how exports (E46), government (E45)
   * and special regimes (E44) become issuable at all in the Dominican Republic, and how a Chilean
   * tenant chooses between an afecta (33) and an exenta (34).
   */
  requestedType?: string | null;
  /**
   * Which kind of document to issue when no type is requested, in a market that has both — the
   * Dominican traditional NCF (serie B) and e-CF (serie E), and any other market whose catalogue
   * declares traditional types beside electronic ones. Chosen by the caller from the company's
   * emission mode, its live ranges and whether it can sign (`InvoicesService.issuableTypes`).
   * Absent: the adapter's own default.
   */
  emissionKind?: EmissionKind | null;
}

/** Signed and transmitted to the authority, or numbered from an authorised range and printed. */
export type EmissionKind = 'ELECTRONIC' | 'TRADITIONAL';

/**
 * Assigns a document its fiscal identity for one market.
 *
 * The interface used to mutate the invoice in place and return `void`, which hid the fact that
 * the assignment has three parts — number, type and authorization expiry — and left the last two
 * unrecorded. `FechaVencimientoSecuencia` is mandatory in an e-CF, so a number without its window
 * cannot be transmitted.
 */
export interface FiscalAdapter {
  /** Fiscal identity for a sales document. */
  assignSalesNumber(context: FiscalAssignmentContext): Promise<FiscalNumberAssignment>;

  /** Fiscal identity for a note that modifies a previously issued document. */
  assignCreditNoteNumber(
    context: FiscalAssignmentContext & { originalInvoice: Invoice },
  ): Promise<FiscalNumberAssignment>;

  /** The types this market lets a tenant issue on a sales document, for the UI to offer. */
  availableSalesTypes(): readonly FiscalDocumentTypeOption[];

  /**
   * Of these types, the ones the company can draw a number for today: an active authorised range
   * with numbers left and not expired. A market whose numbers are not drawn from a stored range
   * (Mexico: the PAC's UUID; Argentina: AFIP's own counter) answers every type.
   */
  liveTypes(context: LiveTypesContext): Promise<ReadonlySet<string>>;

  /**
   * The types the adapter picks by itself, for an invoice with no type requested, in each kind.
   * Absent: any type of that kind. The Dominican adapter picks crédito fiscal or consumo — B01/B02
   * or E31/E32 — and never an export or a government document unasked.
   */
  automaticTypes?(kind: EmissionKind): readonly string[];
}

export interface LiveTypesContext {
  organizationId: string;
  /** The candidate codes, as the adapter's `availableSalesTypes` names them. */
  codes: readonly string[];
  /** The tenant's fiscal date, `YYYY-MM-DD`. */
  today: string;
  manager: EntityManager;
}
