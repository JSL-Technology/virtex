// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPayments } from '../contracts';
import { paymentMethod } from '../kit/payments';

/** Colombia: how companies are paid, and who owns the list of payment forms. */
export const payments: MarketPayments = {
  catalogue: 'EDITABLE',
  authority: 'DIAN',
  // DIAN «Medios de pago» (Anexo técnico de factura electrónica, tabla 13.3.4.2).
  defaults: [
    paymentMethod('10', 'ledger.provisioning.payment_methods.cash', 'CASH', '10'),
    paymentMethod('47', 'ledger.provisioning.payment_methods.bank_transfer', 'BANK_TRANSFER', '47'),
    paymentMethod('20', 'ledger.provisioning.payment_methods.check', 'CHECK', '20'),
    paymentMethod('49', 'ledger.provisioning.payment_methods.debit_card', 'DEBIT_CARD', '49'),
    paymentMethod('48', 'ledger.provisioning.payment_methods.credit_card', 'CREDIT_CARD', '48'),
    paymentMethod('CREDITO', 'ledger.provisioning.payment_methods.on_account', 'CREDIT'),
  ],
};
