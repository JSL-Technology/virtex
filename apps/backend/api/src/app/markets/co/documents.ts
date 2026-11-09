// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments, MarketFiscalDocumentType } from '../contracts';
import { CREDIT_NOTE_ONLY } from '../kit/documents';

/**
 * The codes the regime's builder already emits, transcribed as data (C-04). `sequenceFormat` and
 * `expirationRequired` are left unconfirmed: the mask a series takes and whether the authorisation
 * is time-boxed are facts to confirm with the authority, and inventing them is worse than leaving
 * them open.
 */
export const DOCUMENT_TYPES: readonly MarketFiscalDocumentType[] = [
  { code: '01', labelKey: 'fiscal.co.01', name: 'Factura de Venta', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 10 },
  { code: '91', labelKey: 'fiscal.co.91', name: 'Nota Crédito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 20 },
];

/** Colombia: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * An issued electronic invoice is never annulled: it is reversed with a credit note (91).
   */
  cancellation: { electronic: CREDIT_NOTE_ONLY, traditional: CREDIT_NOTE_ONLY },
  debitNotes: false,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
};
