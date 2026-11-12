// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { needsCredentials } from '../kit/coverage';

/** Dominican Republic: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: true,
  regime: 'DGII e-CF',
  channel: 'CERTIFICATE',
  settingsFields: [],
  rangeSecret: null,
  signing: { regime: 'DGII', representativeAllowed: true },
  coverage: needsCredentials(
      'DGII e-CF',
      'tu certificado digital de la DGII',
    ),
};
