// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { notImplemented } from '../kit/coverage';

/** Venezuela: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: false,
  regime: null,
  coverage: notImplemented(),
};
