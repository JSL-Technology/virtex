/**
 * Why an organization's plan changed: the `reason` on its row in `organization_subscription_history`.
 *
 * A closed list because the history is read by whoever has to reconcile what a customer was charged
 * for against what the product let them use, and a free-text reason cannot be grouped or counted.
 */
export enum PlanChangeReason {
  /** The plan a signup paid for, recorded when its organization is created. */
  REGISTRATION = 'registration',
  /** A new subscription bought from inside the product. */
  CHECKOUT = 'checkout',
  /**
   * The subscription's price changed at the payment provider: an in-app plan change the customer
   * confirmed there, the provider's portal, or an operator in the provider's dashboard.
   */
  PROVIDER_UPDATE = 'provider_update',
  /** Granted without a payment: a tenant provisioned directly, outside the paid signup. */
  PLATFORM_GRANT = 'platform_grant',
  /** A company created under another one, billed through its parent's subscription. */
  BILLED_THROUGH_PARENT = 'billed_through_parent',
}

export interface PlanChange {
  reason: PlanChangeReason;
  /** The person who caused it, when a person did. A provider's own event has none. */
  changedBy?: string | null;
}

/**
 * Where a subscription stands, as the product acts on it. One definition, read by the entitlement
 * guard, by the plan change and by every adapter that records what the provider says.
 */
export const SubscriptionStanding = {
  /** In force: the tenant is entitled, and the plan the subscription bills is the tenant's plan. */
  IN_FORCE: new Set<string>(['active', 'trialing', 'past_due']),
  /**
   * Exists at the provider and still owes something — a first payment, an unpaid renewal, a trial
   * that ended without a payment method. It is settled before it can change; buying a second
   * subscription beside it would bill the customer twice.
   */
  UNSETTLED: new Set<string>(['incomplete', 'unpaid', 'paused']),
} as const;

/** Statuses in which the customer is back in good standing: an open dunning window closes. */
const GOOD_STANDING = new Set<string>(['active', 'trialing']);
/** Statuses that open the dunning window when none is running. */
const IN_ARREARS = new Set<string>(['past_due', 'unpaid']);

/**
 * The dunning window, applied to a status the provider reported.
 *
 * It opens on the first sign of a failed charge and does not move after that. It used to be reset
 * to "now + N days" by every failed retry and by every subscription update in arrears, so the
 * bounded grace period lasted as long as the provider kept retrying, plus N days — and a grace an
 * operator had granted could be cut short by the next event. It closes when the customer is back
 * in good standing. Any other status (cancelled, expired) leaves it alone: a window already open
 * runs to its end, and none is opened for a subscription that has ended.
 */
export function applyDunningWindow(
  organization: { gracePeriodEnd: Date | null },
  status: string,
  graceDays: number,
  now: Date = new Date(),
): void {
  if (GOOD_STANDING.has(status)) {
    organization.gracePeriodEnd = null;
    return;
  }
  if (IN_ARREARS.has(status) && !organization.gracePeriodEnd) {
    const end = new Date(now);
    end.setDate(end.getDate() + graceDays);
    organization.gracePeriodEnd = end;
  }
}
