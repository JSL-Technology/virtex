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
  { code: '01', labelKey: 'fiscal.ec.01', name: 'Factura', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 10 },
  { code: '04', labelKey: 'fiscal.ec.04', name: 'Nota de Crédito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'CREDIT_NOTE', requiresBuyerTaxId: false, sortOrder: 20 },
  { code: '05', labelKey: 'fiscal.ec.05', name: 'Nota de Débito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'DEBIT_NOTE', requiresBuyerTaxId: false, sortOrder: 30 },
];

/** Three digits, as the SRI writes an establishment or an emission point. */
const threeDigits = (code: string | null): string => (code ?? '').padStart(3, '0').slice(0, 3);

/**
 * SRI: `001-001-000000123` — establishment, emission point and a nine-digit sequential. The SRI
 * authorises each emission point and each keeps its own sequential, so a branch with its own codes
 * numbers under them, from that point's own range.
 */
const NUMBERING: MarketNumbering = {
  source: 'AUTHORITY_RANGE',
  emissionKinds: ['ELECTRONIC'],
  requestedType: 'CONFIRM',
  issuingPointRequired: true,
  typeOf: (document) => (document.purpose === 'CREDIT_NOTE' ? '04' : document.purpose === 'DEBIT_NOTE' ? '05' : '01'),
  seriesOf: (point) =>
    point.establishment && point.emissionPoint
      ? { kind: 'EXACT', series: `${threeDigits(point.establishment)}-${threeDigits(point.emissionPoint)}` }
      : undefined,
  // Each emission point the SRI authorises numbers on its own: establishment and point, three digits each.
  acceptsSeries: (_type, series) => /^\d{3}-\d{3}$/.test(series),
  format: (drawn, point) =>
    `${threeDigits(point.establishment)}-${threeDigits(point.emissionPoint)}-${String(drawn.sequence).padStart(9, '0')}`,
};

/** Ecuador: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * An SRI document is annulled with the SRI. The regime does not send that event yet, so the market
   * is told so and offered the credit note.
   */
  cancellation: { electronic: AUTHORITY_EVENT, traditional: AUTHORITY_EVENT },
  // The SRI's motivo is not written yet: the builder does not reference the modified comprobante.
  adjustmentCodes: null,
  // The authority asks the receiver of a document for no verdict of its own here.
  counterpartyVerdictCodes: null,
  debitNotes: false,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
  numbering: NUMBERING,
};
