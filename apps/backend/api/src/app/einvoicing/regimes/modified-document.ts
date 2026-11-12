import { EntityManager } from 'typeorm';
import { Invoice, InvoiceType } from '../../invoices/entities/invoice.entity';
import { FiscalSubmission } from '../entities/fiscal-submission.entity';
import { adjustmentCodeFor } from '../../markets';
import { BadRequestError } from '../../i18n/localized.exception';

/**
 * The document a note modifies, as the authority needs it named — resolved once, written by each
 * regime in its own schema.
 *
 * ## Why this exists
 *
 * A credit or debit note is only intelligible beside the document it corrects, and every authority
 * says so in its own words: the DIAN's `DiscrepancyResponse` and `BillingReference`, SUNAT's
 * `DespatchDocumentReference` and catálogo 09, the SII's `Referencia` with its `CodRef`, the SRI's
 * `infoNotaCredito/codDocModificado`, the CFDI's `CfdiRelacionados` and the NF-e's `refNFe`. Six
 * regimes built notes without any of it (audit FAC-INV-05 / MP-10): the note travelled as a
 * document standing on its own, which the authority either rejects or files against nothing — and
 * a credit the authority never tied to its invoice is a credit the taxpayer cannot prove.
 *
 * Each regime still writes its own elements, because no two name them alike. What is the same in
 * all of them, and therefore resolved here, is WHICH document is referenced, WHEN it was issued,
 * WHAT identifier its authority gave it and WHY the note was written.
 */
export interface ModifiedDocumentReference {
  /**
   * The number the authority gave the referenced document, where its authority assigns numbers
   * before the document is sent.
   *
   * Null where it does not: a CFDI has no fiscal number at all — its identity is the UUID the PAC
   * writes when it stamps — so a regime that references documents by number asks for it with
   * `requiredNumber` and a regime that references them by identifier asks with `requiredKey`.
   */
  fiscalNumber: string | null;
  /** Its document type, as the market's catalogue names it (`E31`, `01`, `33`). */
  documentType: string | null;
  /**
   * The consecutive the authority counted, and the series it belongs to, as they were recorded at
   * issuance — never parsed back out of the formatted number, whose shape is the market's mask.
   *
   * AFIP counts a number within a punto de venta and asks for both separately (`CbtesAsoc`); the
   * SII asks for the folio alone. Null in a market that records neither.
   */
  sequence: number | null;
  series: string | null;
  /** `YYYY-MM-DD`, as the referenced document itself was issued. */
  issueDate: string;
  /**
   * The identifier its regime computed for it — a CUFE, a clave de acceso, a chave de acesso, a
   * CFDI UUID — where the regime computes one and the product recorded it. Null before the
   * referenced document was transmitted, which several regimes accept and some do not.
   */
  documentKey: string | null;
  /**
   * The handle the authority itself returned for the referenced document: the UUID a Mexican PAC
   * assigned on stamping, a protocolo, a trackId. Recorded on its submission, not computed here.
   */
  authorityHandle: string | null;
  /**
   * The authority's own code for why the note was issued (`adjustmentCodeFor`), or null where its
   * authority publishes no such catalogue: Ecuador's nota de crédito carries the motivo as text,
   * and an Argentine one carries only the associated document. A regime that needs a code refuses
   * without one; inventing a code is how a note is filed under a concept nobody chose.
   */
  reasonCode: string | null;
  /** The words the issuer wrote, where the authority prints a description beside the code. */
  reasonText: string | null;
}

/**
 * The number the referenced document was issued under, for a regime that references by number.
 *
 * Refused rather than left blank: a reference with an empty number is a note the authority files
 * against nothing, and it is the same failure the reference exists to prevent.
 */
export function requiredNumber(reference: ModifiedDocumentReference): string {
  if (!reference.fiscalNumber) {
    throw new BadRequestError('einvoicing.modified_document_has_no_authority_number');
  }
  return reference.fiscalNumber;
}

/**
 * The identifier the referenced document's regime gave it — a UUID, a CUFE, a chave de acesso —
 * for a regime that references documents by identifier rather than by number.
 *
 * A note against a document that was never transmitted has none, and that is the honest answer:
 * what has not been filed cannot be corrected, and the SAT rejects a relation to a UUID that does
 * not exist.
 */
export function requiredKey(reference: ModifiedDocumentReference): string {
  const key = reference.documentKey ?? reference.authorityHandle;
  if (!key) {
    throw new BadRequestError('einvoicing.modified_document_has_no_authority_key');
  }
  return key;
}

/**
 * The authority's code for the note's reason, refused rather than guessed.
 *
 * For a regime whose authority publishes a catalogue of correction concepts: a note filed under a
 * concept nobody chose is a note the taxpayer cannot defend, so a market that has not declared its
 * codes blocks the note here instead of transmitting an arbitrary one.
 */
export function requiredReasonCode(reference: ModifiedDocumentReference, reason: string): string {
  if (!reference.reasonCode) {
    throw new BadRequestError('einvoicing.adjustment_reason_has_no_authority_code', { reason });
  }
  return reference.reasonCode;
}

/**
 * The reference for the note being built, or null when the document is not a note.
 *
 * Refuses rather than guesses: a note whose market publishes no code for its reason, or that names
 * a document with no fiscal number, cannot be built — and finding that out here, before anything is
 * signed, is the difference between a correctable error and a rejected filing.
 */
/** Which kind of note this is, which decides whose catalogue its reason is read from. */
function purposeOf(invoice: Invoice): 'CREDIT_NOTE' | 'DEBIT_NOTE' {
  return invoice.type === InvoiceType.DEBIT_NOTE ? 'DEBIT_NOTE' : 'CREDIT_NOTE';
}

export async function modifiedDocumentOf(
  manager: EntityManager,
  invoice: Invoice,
  countryCode: string,
): Promise<ModifiedDocumentReference | null> {
  if (invoice.type === InvoiceType.INVOICE) return null;
  if (!invoice.originalInvoiceId) {
    throw new BadRequestError('einvoicing.note_must_name_the_document_it_modifies', {
      document: invoice.invoiceNumber ?? '',
    });
  }

  const original = await manager.findOne(Invoice, {
    where: { id: invoice.originalInvoiceId, organizationId: invoice.organizationId },
    select: ['id', 'fiscalNumber', 'fiscalDocumentType', 'fiscalSequence', 'fiscalSeries', 'issueDate', 'invoiceNumber'],
  });
  if (!original) {
    throw new BadRequestError('einvoicing.note_must_name_the_document_it_modifies', {
      document: invoice.invoiceNumber ?? '',
    });
  }

  const reason = invoice.adjustmentReason ?? 'OTHER';

  // What the referenced document's own regime recorded for it: the identifier it computed, and the
  // handle the authority returned. A Mexican CFDI is referenced by the second and has no number at
  // all, so neither one can be required of every market.
  const submission = await manager.findOne(FiscalSubmission, {
    where: { invoiceId: original.id, organizationId: invoice.organizationId },
    select: ['id', 'documentKey', 'trackingId'],
  });

  if (!original.fiscalNumber && !submission?.documentKey && !submission?.trackingId) {
    throw new BadRequestError('einvoicing.note_must_name_the_document_it_modifies', {
      document: invoice.invoiceNumber ?? '',
    });
  }

  return {
    fiscalNumber: original.fiscalNumber ?? null,
    documentType: original.fiscalDocumentType ?? null,
    sequence: original.fiscalSequence ?? null,
    series: original.fiscalSeries ?? null,
    issueDate: String(original.issueDate).split('T')[0],
    documentKey: submission?.documentKey ?? null,
    authorityHandle: submission?.trackingId ?? null,
    // The authority's code for the reason, from the catalogue of the kind of note being issued:
    // a credit-note code on a debit note is a code two of these authorities do not publish at all.
    reasonCode: adjustmentCodeFor(countryCode, reason, purposeOf(invoice)),
    // What the issuer wrote on the note itself, where the authority prints a description beside
    // its code. Not invented from the reason: a code already says that much.
    reasonText: invoice.notes?.trim() || null,
  };
}
