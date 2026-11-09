// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPurchases } from '../contracts';
import { AUTHORITY_FISCAL_NUMBER } from '../kit/purchases';

/** Ecuador: what a supplier's document carries, and how a purchase is recorded. */
export const purchases: MarketPurchases = {
  supplierFiscalNumber: false,
  purchaseClassification: false,
  receivedDocument: AUTHORITY_FISCAL_NUMBER,
};
