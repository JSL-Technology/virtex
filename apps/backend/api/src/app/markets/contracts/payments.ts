/**
 * How a market's companies are paid, and who owns the list of payment forms.
 */

/**
 * How a payment method settles, in the vocabulary the e-invoicing builders map to their
 * authority's code. Mirrors `PaymentMethod` in the invoice entity; a string union here so market
 * data does not import a sales entity.
 */
export type PaymentSettlementKind =
  | 'CASH'
  | 'CHECK'
  | 'CREDIT_CARD'
  | 'DEBIT_CARD'
  | 'CREDIT'
  | 'BANK_TRANSFER'
  | 'GIFT_CARD'
  | 'SWAP'
  | 'OTHER';

export const PAYMENT_SETTLEMENT_KINDS: readonly PaymentSettlementKind[] = [
  'CASH',
  'CHECK',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'CREDIT',
  'BANK_TRANSFER',
  'GIFT_CARD',
  'SWAP',
  'OTHER',
];

/** A payment method a company starts with. */
export interface PaymentMethodSeed {
  /** The code documents record. Unique per company; the authority's own where it has one. */
  code: string;
  /** Catalogue key of its name, resolved into the books language when seeded. */
  nameKey: string;
  kind: PaymentSettlementKind;
  /**
   * The code the authority's documents carry for it, or null where the market has no such
   * catalogue or the method has no code in it.
   */
  fiscalCode: string | null;
}

/** Whether the tenant may shape its payment-method catalogue. */
export type PaymentMethodCatalogueOwnership =
  /** The tax authority fixes the list and its codes. Read-only. */
  | 'AUTHORITY_FIXED'
  /** The tenant adds, renames and retires methods; the seeded ones are only a starting point. */
  | 'EDITABLE';

export interface MarketPayments {
  catalogue: PaymentMethodCatalogueOwnership;
  /** Whose catalogue the codes are, where the authority publishes one. */
  authority: string | null;
  defaults: readonly PaymentMethodSeed[];
}
