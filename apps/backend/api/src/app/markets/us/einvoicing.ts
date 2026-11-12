// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketEInvoicing } from '../contracts';
import { notApplicable } from '../kit/coverage';

/** United States: whether the law requires electronic invoicing, and what the product does about it. */
export const einvoicing: MarketEInvoicing = {
  required: false,
  regime: null,
  channel: null,
  settingsFields: [],
  rangeSecret: null,

  // Nothing is signed with a certificate here.
  signing: null,

  // Not a gap: a US sales invoice carries no fiscal stamp, so there is nothing to implement.
  coverage: notApplicable('La factura de venta estadounidense no lleva sello fiscal'),
};
