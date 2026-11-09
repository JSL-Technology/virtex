// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments } from '../contracts';

/** United States: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: false,
  types: [],
  cancellation: null,
  debitNotes: true,
  defaultCustomer: { nameKey: 'ledger.provisioning.walk_in_customer' },
};
