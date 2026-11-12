// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPurchases } from '../contracts';
import { SUPPLIER_INVOICE_NUMBER } from '../kit/purchases';

/** United States: what a supplier's document carries, and how a purchase is recorded. */
export const purchases: MarketPurchases = {
  supplierFiscalNumber: false,
  purchaseClassification: false,
  receivedDocument: SUPPLIER_INVOICE_NUMBER,
  // Beyond the document and the amounts, the authority asks nothing of a purchase here.
  fiscalAttributes: [],
};
