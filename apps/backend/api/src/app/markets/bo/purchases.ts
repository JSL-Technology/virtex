// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPurchases } from '../contracts';
import { AUTHORITY_FISCAL_NUMBER } from '../kit/purchases';

/** Bolivia: what a supplier's document carries, and how a purchase is recorded. */
export const purchases: MarketPurchases = {
  supplierFiscalNumber: false,
  purchaseClassification: false,
  receivedDocument: AUTHORITY_FISCAL_NUMBER,
  // Beyond the document and the amounts, the authority asks nothing of a purchase here.
  fiscalAttributes: [],
};
