// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { implemented } from '../kit/coverage';

/** United States: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: false,
  regime: null,
  coverage: implemented('No aplica: la factura de venta estadounidense no lleva sello fiscal'),
};
