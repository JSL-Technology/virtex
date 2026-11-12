// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { notImplemented } from '../kit/coverage';

/** El Salvador: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: true,
  regime: 'DTE El Salvador',
  // The law has a regime; the product does not operate it, so there is no channel to
  // configure and the settings screen says so rather than showing an empty form.
  channel: null,
  settingsFields: [],
  rangeSecret: null,
  coverage: notImplemented(),
};
