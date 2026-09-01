import { EntityManager } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { NcfType } from '../../compliance/entities/ncf-sequence.entity';

/** The fiscal identity a regime assigns to a document at the moment it is issued. */
export interface FiscalNumberAssignment {
  /** The fiscal number itself, or null in a regime that issues none. */
  ncf: string | null;
  /** The document type the number was drawn from (`E31`, `B01`…). */
  documentType: string | null;
  /** Expiry of the authorization the number belongs to, `YYYY-MM-DD`, or null. */
  expiresAt: string | null;
}

export interface FiscalAssignmentContext {
  invoice: Invoice;
  organizationId: string;
  manager: EntityManager;
  /**
   * Type explicitly requested by the caller. Where present the adapter must honour it or refuse —
   * it is how exports (E46), government (E45) and special regimes (E44) become issuable at all.
   */
  requestedType?: NcfType | null;
}

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
  availableSalesTypes(): readonly NcfType[];
}
