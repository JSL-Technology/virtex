import type { PaymentMethodSeed, PaymentSettlementKind } from '../contracts';

/** A payment method seed. */
export const paymentMethod = (
  code: string,
  nameKey: string,
  kind: PaymentSettlementKind,
  fiscalCode: string | null = null,
): PaymentMethodSeed => ({ code, nameKey, kind, fiscalCode });

/**
 * The methods a market without an authority catalogue of payment forms starts with. Codes are
 * mnemonic and stable; the names follow the books language.
 */
export const GENERIC_PAYMENT_METHODS: readonly PaymentMethodSeed[] = [
  paymentMethod('CASH', 'ledger.provisioning.payment_methods.cash', 'CASH'),
  paymentMethod('TRANSFER', 'ledger.provisioning.payment_methods.bank_transfer', 'BANK_TRANSFER'),
  paymentMethod('CHECK', 'ledger.provisioning.payment_methods.check', 'CHECK'),
  paymentMethod('DEBIT_CARD', 'ledger.provisioning.payment_methods.debit_card', 'DEBIT_CARD'),
  paymentMethod('CREDIT_CARD', 'ledger.provisioning.payment_methods.credit_card', 'CREDIT_CARD'),
  paymentMethod('CREDIT', 'ledger.provisioning.payment_methods.on_account', 'CREDIT'),
];
