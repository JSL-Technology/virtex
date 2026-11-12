// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { needsCredentials } from '../kit/coverage';

/** Colombia: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: true,
  regime: 'DIAN Factura Electrónica',
  channel: 'ENDPOINT',
  settingsFields: ['resolutionNumber'],
  rangeSecret: 'TECHNICAL_KEY',
  coverage: needsCredentials(
      'DIAN UBL 2.1 con CUFE',
      'tu certificado de firma digital, la resolución de facturación y tu clave técnica',
    ),
};
