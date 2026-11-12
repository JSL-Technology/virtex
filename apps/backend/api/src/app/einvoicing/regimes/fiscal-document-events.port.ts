import type { CounterpartyVerdict, FiscalDocumentEvent } from '../entities/fiscal-document-event.entity';

export interface CounterpartyVerdictRequest {
  /** The identifier of the party that issued the document being answered. */
  counterpartyTaxId: string;
  /** The number their authority assigned to it. */
  documentNumber: string;
  /** Issue date they stated, `YYYY-MM-DD`. */
  documentDate: string;
  /** Total they stated. It must match theirs to the cent or the authority rejects the answer. */
  documentTotal: number;
  verdict: CounterpartyVerdict;
  /** Mandatory when the verdict is a rejection. */
  rejectionReason?: string;
}

export interface SequenceVoidRequest {
  /** A document-type code, not `NcfType`: the boundary carries a plain string now (C-03). */
  type: string;
  /** First sequence number of the stretch, inclusive. */
  from: number;
  /** Last sequence number of the stretch, inclusive. */
  to: number;
}

/**
 * What a regime does with a declaration ABOUT documents, as the door asks for it.
 *
 * Two acts every authority has in some form — answering a counterparty's document and declaring
 * authorised numbers that will never be used — and each regime builds, seals and transmits them in
 * its own schema. The shape is not invented here: it is the one `fiscal_document_events` already
 * records, with the kinds and the verdicts as facts and the codes written by the market (§2.11).
 *
 * Only the Dominican regime implements it today, which is why it is an OPTIONAL member of the
 * adapter: a market that does not answer for these says so by not having one, and the door says
 * that plainly instead of naming one country's service.
 */
export interface FiscalDocumentEventsPort {
  /** Answer a comprobante a counterparty issued to this tenant: accept it, or reject it with a reason. */
  answerReceived(organizationId: string, request: CounterpartyVerdictRequest): Promise<FiscalDocumentEvent>;
  /** Declare a stretch of an authorised range as annulled. */
  voidRange(organizationId: string, request: SequenceVoidRequest): Promise<FiscalDocumentEvent>;
}
