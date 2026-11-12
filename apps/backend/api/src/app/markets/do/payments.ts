// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketPayments, PaymentMethodSeed } from '../contracts';
import { paymentMethod } from '../kit/payments';

/**
 * The DGII's 606 «Forma de pago» catalogue (Norma General 07-2018), 01 to 07. A Dominican company
 * cannot add an eighth: the purchase report carries these codes and nothing else, which is why the
 * catalogue is `AUTHORITY_FIXED` for this market and only this one.
 */
const AUTHORITY_PAYMENT_FORMS: readonly PaymentMethodSeed[] = [
  paymentMethod('01', 'ledger.provisioning.payment_methods.dgii_cash', 'CASH', '01'),
  paymentMethod('02', 'ledger.provisioning.payment_methods.dgii_check_transfer', 'BANK_TRANSFER', '02'),
  paymentMethod('03', 'ledger.provisioning.payment_methods.dgii_card', 'CREDIT_CARD', '03'),
  paymentMethod('04', 'ledger.provisioning.payment_methods.dgii_credit', 'CREDIT', '04'),
  paymentMethod('05', 'ledger.provisioning.payment_methods.dgii_barter', 'SWAP', '05'),
  paymentMethod('06', 'ledger.provisioning.payment_methods.dgii_credit_note', 'OTHER', '06'),
  paymentMethod('07', 'ledger.provisioning.payment_methods.dgii_mixed', 'OTHER', '07'),
];
/** Dominican Republic: how companies are paid, and who owns the list of payment forms. */
export const payments: MarketPayments = {
  catalogue: 'AUTHORITY_FIXED',
  authority: 'DGII',
  defaults: AUTHORITY_PAYMENT_FORMS,
};
