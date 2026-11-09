// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPayments } from '../contracts';
import { paymentMethod } from '../kit/payments';

/** Mexico: how companies are paid, and who owns the list of payment forms. */
export const payments: MarketPayments = {
  catalogue: 'EDITABLE',
  authority: 'SAT',
  // SAT `c_FormaPago`, which every CFDI 4.0 carries.
  defaults: [
    paymentMethod('01', 'ledger.provisioning.payment_methods.cash', 'CASH', '01'),
    paymentMethod('02', 'ledger.provisioning.payment_methods.check', 'CHECK', '02'),
    paymentMethod('03', 'ledger.provisioning.payment_methods.bank_transfer', 'BANK_TRANSFER', '03'),
    paymentMethod('04', 'ledger.provisioning.payment_methods.credit_card', 'CREDIT_CARD', '04'),
    paymentMethod('28', 'ledger.provisioning.payment_methods.debit_card', 'DEBIT_CARD', '28'),
    paymentMethod('99', 'ledger.provisioning.payment_methods.to_be_defined', 'CREDIT', '99'),
  ],
};
