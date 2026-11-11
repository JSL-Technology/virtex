// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments, MarketFiscalDocumentType, MarketNumbering } from '../contracts';
import { CREDIT_NOTE_ONLY } from '../kit/documents';

/**
 * The codes the regime's builder already emits, transcribed as data (C-04). `sequenceFormat` and
 * `expirationRequired` are left unconfirmed: the mask a series takes and whether the authorisation
 * is time-boxed are facts to confirm with the authority, and inventing them is worse than leaving
 * them open.
 */
export const DOCUMENT_TYPES: readonly MarketFiscalDocumentType[] = [
  { code: '33', labelKey: 'fiscal.cl.33', name: 'Factura Electrónica', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: true, sortOrder: 10 },
  { code: '34', labelKey: 'fiscal.cl.34', name: 'Factura No Afecta o Exenta Electrónica', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: true, sortOrder: 20 },
  { code: '56', labelKey: 'fiscal.cl.56', name: 'Nota de Débito Electrónica', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'DEBIT_NOTE', requiresBuyerTaxId: true, sortOrder: 25 },
  { code: '61', labelKey: 'fiscal.cl.61', name: 'Nota de Crédito Electrónica', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'CREDIT_NOTE', requiresBuyerTaxId: true, sortOrder: 30 },
];

/**
 * SII: the folio, written bare, from a CAF — which also carries the key that seals the document's
 * timbre. Whether a sale is an afecta (33) or an exenta (34) is decided by whether it bears VAT,
 * never by the caller: the SII rejects an exempt sale issued on an afecta folio.
 */
const NUMBERING: MarketNumbering = {
  source: 'AUTHORITY_RANGE',
  emissionKinds: ['ELECTRONIC'],
  requestedType: 'CONFIRM',
  typeOf(document) {
    if (document.purpose === 'CREDIT_NOTE') return '61';
    if (document.purpose === 'DEBIT_NOTE') return '56';
    return document.chargesTax ? '33' : '34';
  },
  // A CAF authorises folios of a type, with no series.
  acceptsSeries: (_type, series) => series === '',
  format: (drawn) => String(drawn.sequence),
};

/** Chile: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * An issued DTE is never annulled: it is reversed with a credit note (61).
   */
  cancellation: { electronic: CREDIT_NOTE_ONLY, traditional: CREDIT_NOTE_ONLY },
  // The SII's código de referencia is not written yet: the builder does not reference the modified DTE.
  adjustmentCodes: null,
  debitNotes: false,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
  numbering: NUMBERING,
};
