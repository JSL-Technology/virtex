// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPayments } from '../contracts';
import { GENERIC_PAYMENT_METHODS } from '../kit/payments';

/** Ecuador: how companies are paid, and who owns the list of payment forms. */
export const payments: MarketPayments = {
  catalogue: 'EDITABLE',
  authority: null,
  defaults: GENERIC_PAYMENT_METHODS,
};
