// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { needsCredentials } from '../kit/coverage';

/** Peru: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: true,
  regime: 'SUNAT CPE',
  coverage: needsCredentials(
      'SUNAT UBL 2.1',
      'tu certificado digital y tus credenciales SOL',
    ),
};
