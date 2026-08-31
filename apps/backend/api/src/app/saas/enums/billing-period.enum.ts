/**
 * How often a subscription is charged.
 *
 * `Plan.annualPriceId` existed on the entity from the beginning and was never written, never read
 * and never offered, so every customer was billed monthly whatever the product said. Making the
 * period an explicit value — rather than "whichever price id happened to be non-null" — is what
 * lets the signup, the in-app upgrade and the boot-time price verification agree on what is being
 * charged.
 */
export const BILLING_PERIODS = ['monthly', 'annual'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];
