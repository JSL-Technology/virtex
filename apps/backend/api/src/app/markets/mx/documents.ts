// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments, MarketFiscalDocumentType, MarketNumbering } from '../contracts';
import { AUTHORITY_EVENT } from '../kit/documents';

/**
 * The codes the regime's builder already emits, transcribed as data (C-04). `sequenceFormat` and
 * `expirationRequired` are left unconfirmed: the mask a series takes and whether the authorisation
 * is time-boxed are facts to confirm with the authority, and inventing them is worse than leaving
 * them open.
 */
export const DOCUMENT_TYPES: readonly MarketFiscalDocumentType[] = [
  { code: 'I', labelKey: 'fiscal.mx.i', name: 'CFDI de Ingreso', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 10 },
  { code: 'E', labelKey: 'fiscal.mx.e', name: 'CFDI de Egreso', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'CREDIT_NOTE', requiresBuyerTaxId: false, sortOrder: 20 },
];

/**
 * SAT, through a PAC: there is no fiscal number to assign. A CFDI's fiscal identity is the UUID the
 * PAC writes when it stamps; the `Folio` is the company's own reference. What is recorded at issue is
 * the `TipoDeComprobante`: an ingreso, an egreso for a credit note, and an ingreso related to the
 * original for a debit note.
 */
const NUMBERING: MarketNumbering = {
  source: 'STAMP',
  emissionKinds: ['ELECTRONIC'],
  requestedType: 'CONFIRM',
  typeOf: (document) => (document.purpose === 'CREDIT_NOTE' ? 'E' : 'I'),
};

/** Mexico: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * A CFDI is cancelled with the SAT, within its window and with its reasons. The regime does not
   * send that event yet, so the market is told so and offered the credit note.
   */
  cancellation: { electronic: AUTHORITY_EVENT, traditional: AUTHORITY_EVENT },
  // The CFDI relates documents by UUID; its `TipoRelacion` is not written yet.
  adjustmentCodes: null,
  // The authority asks the receiver of a document for no verdict of its own here.
  counterpartyVerdictCodes: null,
  debitNotes: false,
  defaultCustomer: { nameKey: 'ledger.provisioning.general_public' },
  numbering: NUMBERING,
};
