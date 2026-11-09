// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketReturns } from '../contracts';
import { needsConfiguration } from '../kit/coverage';

/** Mexico: the periodic returns its authority requires, and what the product files. */
export const returns: MarketReturns = {
  generator: 'SAT',
  dueDay: null,
  prepareWith: [],
  obligations: ['DIOT'],
  coverage: [
    { capability: 'electronicAccounting', ...needsConfiguration(
        'Catálogo, Balanza y Pólizas (Anexo 24 v1.3)',
        'el código agrupador del SAT en cada cuenta de tu catálogo',
      ) },
  ],
};
