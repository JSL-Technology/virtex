// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketReturns } from '../contracts';
import { implemented, notImplemented } from '../kit/coverage';

/** Dominican Republic: the periodic returns its authority requires, and what the product files. */
export const returns: MarketReturns = {
  generator: 'DGII',
  dueDay: 15,
  prepareWith: [],
  obligations: ['606', '607', '608', 'IT-1'],
  coverage: [
    { capability: 'periodicReturns', ...implemented('Formatos 606, 607, 608 y 609') },
    { capability: 'periodicReturns', ...notImplemented('IT-1, IR-17 e IR-3') },
  ],
};
