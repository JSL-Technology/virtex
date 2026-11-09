// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments, MarketFiscalDocumentType } from '../contracts';
import { AUTHORITY_EVENT } from '../kit/documents';

/**
 * The codes the regime's builder already emits, transcribed as data (C-04). `sequenceFormat` and
 * `expirationRequired` are left unconfirmed: the mask a series takes and whether the authorisation
 * is time-boxed are facts to confirm with the authority, and inventing them is worse than leaving
 * them open.
 */
export const DOCUMENT_TYPES: readonly MarketFiscalDocumentType[] = [
  { code: '01', labelKey: 'fiscal.pe.01', name: 'Factura', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 10 },
  { code: '03', labelKey: 'fiscal.pe.03', name: 'Boleta de Venta', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 20 },
  { code: '07', labelKey: 'fiscal.pe.07', name: 'Nota de Crédito', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 30 },
];

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
};
