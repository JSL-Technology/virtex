/**
 * A subscription charge the platform collected, for whoever must document it.
 *
 * The platform is itself a Dominican taxpayer: every charge to a customer company is a sale that
 * needs its comprobante. Payments (`identidad`) collects; Sales (`ventas`) issues. Neither imports
 * the other — the fact travels through this contract, emitted with `emitAsync` so the issuer's
 * answer (the invoice it created) comes back to the payment that asked.
 */
export const SUBSCRIPTION_CHARGED = 'billing.subscription_charged';

export interface SubscriptionChargedEvent {
  /** The charge (`billing_payment_intents.id`): the idempotency key of the invoice. */
  chargeId: string;
  /** The customer company. */
  organizationId: string;
  legalName: string;
  /** Its RNC or cédula; null for a company that has not stated one (invoiced as consumo). */
  taxId: string | null;
  country: string | null;
  email: string | null;
  planSlug: string;
  period: string;
  currency: string;
  /** Total charged, ITBIS included, in minor units. */
  amountMinor: number;
  /** The ITBIS inside it. */
  taxMinor: number;
  chargedAt: string;
}

/** What the issuer answers: the invoice id, or null when the platform is not set up to invoice. */
export type SubscriptionChargedAnswer = { invoiceId: string } | null;
