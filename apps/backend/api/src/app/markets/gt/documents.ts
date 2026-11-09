// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments } from '../contracts';

/** Guatemala: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: [],
  cancellation: null,
  debitNotes: true,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
};
