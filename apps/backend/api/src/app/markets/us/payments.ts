// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPayments, PaymentMethodSeed } from '../contracts';
import { paymentMethod } from '../kit/payments';

/**
 * How a US business is paid. ACH is the default for business-to-business; Zelle is common for small
 * businesses; «On account» is the credit sale the due date turns an invoice into.
 */
const PAYMENT_METHODS: readonly PaymentMethodSeed[] = [
  paymentMethod('ACH', 'ledger.provisioning.payment_methods.ach', 'BANK_TRANSFER'),
  paymentMethod('WIRE', 'ledger.provisioning.payment_methods.wire', 'BANK_TRANSFER'),
  paymentMethod('CHECK', 'ledger.provisioning.payment_methods.check', 'CHECK'),
  paymentMethod('CARD', 'ledger.provisioning.payment_methods.card', 'CREDIT_CARD'),
  paymentMethod('ZELLE', 'ledger.provisioning.payment_methods.zelle', 'BANK_TRANSFER'),
  paymentMethod('CASH', 'ledger.provisioning.payment_methods.cash', 'CASH'),
  paymentMethod('ON_ACCOUNT', 'ledger.provisioning.payment_methods.on_account', 'CREDIT'),
];
/** United States: how companies are paid, and who owns the list of payment forms. */
export const payments: MarketPayments = {
  catalogue: 'EDITABLE',
  authority: null,
  defaults: PAYMENT_METHODS,
};
