// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { needsCredentials } from '../kit/coverage';

/** Chile: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: true,
  regime: 'SII DTE',
  coverage: needsCredentials(
      'SII — DTE 33/34/61',
      'tu certificado digital y tus folios CAF del SII',
    ),
};
