// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments } from '../contracts';
import { NO_FISCAL_NUMBERING } from '../kit/documents';

/** Venezuela: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: [],
  cancellation: null,
  // The documents carry no authority reason code: there is no authority behind them.
  adjustmentCodes: null,
  debitNotes: true,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
  // The product issues no fiscal number here: the commercial number is the document's only one.
  numbering: NO_FISCAL_NUMBERING,
};
