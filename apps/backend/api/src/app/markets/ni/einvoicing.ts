// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { notApplicable } from '../kit/coverage';

/** Nicaragua: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: false,
  regime: null,
  channel: null,
  settingsFields: [],
  rangeSecret: null,

  // Nothing is signed with a certificate here.
  signing: null,

  // The law does not mandate electronic invoicing here (`required: false`).
  coverage: notApplicable(),
};
