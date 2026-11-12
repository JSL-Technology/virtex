// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { needsCredentials } from '../kit/coverage';

/** Argentina: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: true,
  regime: 'AFIP CAE',
  channel: 'ENDPOINT',
  settingsFields: [],
  rangeSecret: null,
  signing: { regime: 'AFIP', representativeAllowed: false },
  coverage: needsCredentials(
      'AFIP WSFEv1 con CAE',
      'tu certificado de AFIP y el punto de venta habilitado',
    ),
};
