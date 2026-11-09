// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketReturns } from '../contracts';
import { PREPARE_WITH_LEDGERS } from '../kit/returns';
import { notImplemented } from '../kit/coverage';

/** Venezuela: the periodic returns its authority requires, and what the product files. */
export const returns: MarketReturns = {
  generator: null,
  dueDay: null,
  prepareWith: PREPARE_WITH_LEDGERS,
  obligations: [],
  coverage: [
    { capability: 'periodicReturns', ...notImplemented() },
  ],
};
