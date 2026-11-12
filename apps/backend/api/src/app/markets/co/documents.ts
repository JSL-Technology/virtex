// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketAdjustmentCodes, MarketDocuments, MarketFiscalDocumentType, MarketNumbering } from '../contracts';
import { CREDIT_NOTE_ONLY } from '../kit/documents';

/**
 * The codes the regime's builder already emits, transcribed as data (C-04). `sequenceFormat` and
 * `expirationRequired` are left unconfirmed: the mask a series takes and whether the authorisation
 * is time-boxed are facts to confirm with the authority, and inventing them is worse than leaving
 * them open.
 */
export const DOCUMENT_TYPES: readonly MarketFiscalDocumentType[] = [
  { code: '01', labelKey: 'fiscal.co.01', name: 'Factura de Venta', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 10 },
  { code: '91', labelKey: 'fiscal.co.91', name: 'Nota Crédito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'CREDIT_NOTE', requiresBuyerTaxId: false, sortOrder: 20 },
  { code: '92', labelKey: 'fiscal.co.92', name: 'Nota Débito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'DEBIT_NOTE', requiresBuyerTaxId: false, sortOrder: 30 },
];

/**
 * The DIAN's «concepto de corrección», written in the note's `DiscrepancyResponse/ResponseCode`.
 *
 * The catalogue of a nota crédito and that of a nota débito are different lists that happen to
 * start at 1, so a reason is mapped to the list of the note it belongs to:
 *
 * | Nota crédito | | Nota débito | |
 * |---|---|---|---|
 * | 1 | Devolución parcial o no aceptación parcial | 1 | Intereses |
 * | 2 | Anulación de factura electrónica | 2 | Gastos por cobrar |
 * | 3 | Rebaja o descuento parcial o total | 3 | Cambio del valor |
 * | 4 | Ajuste de precio | 4 | Otros |
 * | 5 | Otros | | |
 *
 * *Verificar con contabilidad/legal*: both lists are in the DIAN's anexo técnico (this follows
 * 1.8) and the DIAN revises it; confirm code by code before filing.
 */
const ADJUSTMENT_CODES: MarketAdjustmentCodes = {
  // Conceptos de nota crédito: 1 devolución, 2 anulación, 3 rebaja, 4 ajuste de precio, 5 otros.
  creditNote: { GOODS_RETURN: '1', ANNULMENT: '2', PRICE_REDUCTION: '3', DETAIL_CORRECTION: '4', OTHER: '5' },
  // Conceptos de nota débito, a list of four: 1 intereses, 2 gastos por cobrar, 3 cambio del
  // valor, 4 otros. `5` is not in it, which is what one flat record wrote here for `OTHER`.
  debitNote: { LATE_PAYMENT_INTEREST: '1', ADDITIONAL_CHARGES: '2', PRICE_INCREASE: '3', PENALTY: '4', OTHER: '4' },
};

/**
 * DIAN: the number is the resolution's prefix and a consecutive within the authorised range, written
 * without a separator (`SETP990000001`). The type follows from what the document is: a sale, a credit
 * note or a debit note.
 */
const NUMBERING: MarketNumbering = {
  source: 'AUTHORITY_RANGE',
  emissionKinds: ['ELECTRONIC'],
  requestedType: 'CONFIRM',
  typeOf: (document) => (document.purpose === 'CREDIT_NOTE' ? '91' : document.purpose === 'DEBIT_NOTE' ? '92' : '01'),
  format: (drawn) => `${drawn.series}${drawn.sequence}`,
};

/** Colombia: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * An issued electronic invoice is never annulled: it is reversed with a credit note (91).
   */
  cancellation: { electronic: CREDIT_NOTE_ONLY, traditional: CREDIT_NOTE_ONLY },
  adjustmentCodes: ADJUSTMENT_CODES,
  // The authority asks the receiver of a document for no verdict of its own here.
  counterpartyVerdictCodes: null,
  // The regime writes both notes now: each as its own UBL document, referencing the one it
  // corrects and carrying the DIAN's concepto for why.
  debitNotes: true,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
  numbering: NUMBERING,
};
