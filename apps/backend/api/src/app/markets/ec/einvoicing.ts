// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { needsCredentials } from '../kit/coverage';

/** Ecuador: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: true,
  regime: 'SRI Comprobantes Electrónicos',
  channel: 'ENDPOINT',
  settingsFields: ['establishment', 'emissionPoint', 'numericCode'],
  rangeSecret: null,
  coverage: needsCredentials(
      'SRI 2.1.0 con clave de acceso',
      'tu certificado de firma electrónica y tu punto de emisión',
    ),
};
