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
  { code: '1', labelKey: 'fiscal.ar.1', name: 'Factura A', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 10 },
  { code: '3', labelKey: 'fiscal.ar.3', name: 'Nota de Crédito A', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 20 },
  { code: '6', labelKey: 'fiscal.ar.6', name: 'Factura B', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 30 },
  { code: '8', labelKey: 'fiscal.ar.8', name: 'Nota de Crédito B', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 40 },
  { code: '11', labelKey: 'fiscal.ar.11', name: 'Factura C', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 50 },
  { code: '13', labelKey: 'fiscal.ar.13', name: 'Nota de Crédito C', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 60 },
];

/** Argentina: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * A document AFIP authorised is never annulled: it is reversed with a credit note.
   */
  cancellation: { electronic: CREDIT_NOTE_ONLY, traditional: CREDIT_NOTE_ONLY },
  debitNotes: false,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
};
