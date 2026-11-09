// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPayments } from '../contracts';
import { paymentMethod } from '../kit/payments';

/** Brazil: how companies are paid, and who owns the list of payment forms. */
export const payments: MarketPayments = {
  catalogue: 'EDITABLE',
  authority: 'SEFAZ',
  // SEFAZ `tPag` (NF-e 4.00): PIX and boleto are how Brazil pays.
  defaults: [
    paymentMethod('17', 'ledger.provisioning.payment_methods.pix', 'BANK_TRANSFER', '17'),
    paymentMethod('15', 'ledger.provisioning.payment_methods.boleto', 'BANK_TRANSFER', '15'),
    paymentMethod('18', 'ledger.provisioning.payment_methods.bank_transfer', 'BANK_TRANSFER', '18'),
    paymentMethod('01', 'ledger.provisioning.payment_methods.cash', 'CASH', '01'),
    paymentMethod('03', 'ledger.provisioning.payment_methods.credit_card', 'CREDIT_CARD', '03'),
    paymentMethod('04', 'ledger.provisioning.payment_methods.debit_card', 'DEBIT_CARD', '04'),
    paymentMethod('02', 'ledger.provisioning.payment_methods.check', 'CHECK', '02'),
  ],
};
