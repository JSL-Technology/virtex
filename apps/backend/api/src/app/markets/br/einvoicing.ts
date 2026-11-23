// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { needsCredentials } from '../kit/coverage';

/** Brazil: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: true,
  regime: 'NF-e',
  channel: 'ENDPOINT',
  settingsFields: ['stateCode', 'municipalityCode', 'numericCode'],
  rangeSecret: null,
  signing: { regime: 'NFE', representativeAllowed: false },
  coverage: needsCredentials(
      'NF-e 4.00',
      'seu certificado A1 ou A3 e a homologação na SEFAZ do seu estado',
    ),
};
