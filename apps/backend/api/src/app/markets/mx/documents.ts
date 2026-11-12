// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAdjustmentCodes, MarketDocuments, MarketFiscalDocumentType, MarketNumbering } from '../contracts';
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

/**
 * `c_TipoRelacion`: what the relation between this comprobante and the one it names IS.
 *
 * The SAT does not ask why in words and publishes no catalogue of correction concepts: it asks what
 * kind of document this is with respect to the other. `01` is a credit note of the related
 * documents, `02` a debit note of them, `03` a return of goods over a previous invoice — which is
 * why the same canonical reason is coded differently depending on the kind of note that carries it.
 *
 * *Verificar con contabilidad/legal*: the SAT republishes the catálogo with Anexo 20, and `04`
 * sustitución de los CFDI previos belongs to a replacement comprobante rather than to a note, so it
 * is not written here.
 */
const ADJUSTMENT_CODES: MarketAdjustmentCodes = {
  creditNote: { GOODS_RETURN: '03', ANNULMENT: '01', PRICE_REDUCTION: '01', DETAIL_CORRECTION: '01', OTHER: '01' },
  debitNote: { LATE_PAYMENT_INTEREST: '02', ADDITIONAL_CHARGES: '02', PRICE_INCREASE: '02', PENALTY: '02', OTHER: '02' },
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
  adjustmentCodes: ADJUSTMENT_CODES,
  // The authority asks the receiver of a document for no verdict of its own here.
  counterpartyVerdictCodes: null,
  // A Mexican debit note is an ingreso that relates to the document it adds to, with
  // `TipoRelacion` `02` saying so. The regime writes that relation now.
  debitNotes: true,
  defaultCustomer: { nameKey: 'ledger.provisioning.general_public' },
  numbering: NUMBERING,
};
