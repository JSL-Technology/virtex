// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketReturns } from '../contracts';
import { PREPARE_WITH_LEDGERS } from '../kit/returns';
import { notImplemented } from '../kit/coverage';

/** Paraguay: the periodic returns its authority requires, and what the product files. */
export const returns: MarketReturns = {
  generator: null,
  dueDay: null,
  prepareWith: PREPARE_WITH_LEDGERS,
  obligations: [],
  // No generator here: the product produces no return file for this market yet.
  filings: [],
  coverage: [
    { capability: 'periodicReturns', ...notImplemented() },
  ],
};
