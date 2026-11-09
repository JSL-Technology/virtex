// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { needsCredentials } from '../kit/coverage';

/** Mexico: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: true,
  regime: 'CFDI 4.0',
  coverage: needsCredentials(
      'CFDI 4.0',
      'tu Certificado de Sello Digital y un contrato con un PAC',
    ),
};
