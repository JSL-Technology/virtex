// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments, MarketFiscalDocumentType, MarketNumbering } from '../contracts';
import { isValidPeruvianRuc } from './identity';
import { AUTHORITY_EVENT } from '../kit/documents';

/**
 * The codes the regime's builder already emits, transcribed as data (C-04). `sequenceFormat` and
 * `expirationRequired` are left unconfirmed: the mask a series takes and whether the authorisation
 * is time-boxed are facts to confirm with the authority, and inventing them is worse than leaving
 * them open.
 */
export const DOCUMENT_TYPES: readonly MarketFiscalDocumentType[] = [
  { code: '01', labelKey: 'fiscal.pe.01', name: 'Factura', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: true, sortOrder: 10 },
  { code: '03', labelKey: 'fiscal.pe.03', name: 'Boleta de Venta', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 20 },
  { code: '07', labelKey: 'fiscal.pe.07', name: 'Nota de Crédito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'CREDIT_NOTE', requiresBuyerTaxId: false, sortOrder: 30 },
  { code: '08', labelKey: 'fiscal.pe.08', name: 'Nota de Débito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'DEBIT_NOTE', requiresBuyerTaxId: false, sortOrder: 40 },
];

/**
 * SUNAT: `F001-00000123`, a series the taxpayer registered and an eight-digit correlative. A factura is
 * issued to a buyer with a valid RUC — it is what grants the IGV credit — and a boleta to anybody
 * else; SUNAT permits a boleta to a buyer who holds a RUC too, so the issuer may choose it.
 */
/** The letters a series of each type may begin with (catálogo 01). */
const SERIES_LETTERS: Readonly<Record<string, readonly string[]>> = { '01': ['F'], '03': ['B'], '07': ['F', 'B'], '08': ['F', 'B'] };

const NUMBERING: MarketNumbering = {
  source: 'AUTHORITY_RANGE',
  emissionKinds: ['ELECTRONIC'],
  requestedType: 'CHOOSE',
  typeOf(document) {
    if (document.purpose === 'CREDIT_NOTE') return '07';
    if (document.purpose === 'DEBIT_NOTE') return '08';
    return isValidPeruvianRuc(document.buyer.taxId ?? '') ? '01' : '03';
  },
  // A note is drawn from a series of the same letter as the document it modifies: SUNAT refuses an
  // F note on a boleta, and a B note on a factura.
  seriesOf: (_point, document) => {
    if (document.purpose === 'INVOICE') return undefined;
    const letter = (document.original?.fiscalNumber ?? '').trim().charAt(0).toUpperCase();
    return letter === 'F' || letter === 'B' ? { kind: 'PREFIX', prefix: letter } : undefined;
  },
  // Four characters, the first the document's letter: F a factura's, B a boleta's, either for a note.
  acceptsSeries: (type, series) => {
    if (!/^[FB][A-Z0-9]{3}$/.test(series)) return false;
    const letters = SERIES_LETTERS[type];
    return !letters || letters.includes(series.charAt(0));
  },
  format: (drawn) => `${drawn.series}-${String(drawn.sequence).padStart(8, '0')}`,
};

/** Peru: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * A SUNAT document is withdrawn with a comunicación de baja. The regime does not send that event
   * yet, so the market is told so and offered the credit note.
   */
  cancellation: { electronic: AUTHORITY_EVENT, traditional: AUTHORITY_EVENT },
  debitNotes: false,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
  numbering: NUMBERING,
};
