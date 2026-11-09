// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { notImplemented } from '../kit/coverage';

/** Paraguay: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: true,
  regime: 'SET e-Kuatia',
  coverage: notImplemented(),
};
