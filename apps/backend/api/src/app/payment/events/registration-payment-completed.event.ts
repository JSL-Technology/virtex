/** Subscription facts captured from Stripe when a signup payment succeeds. */
export interface RegistrationSubscriptionInfo {
  customerId: string;
  subscriptionId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
}

/**
 * Emitted by the payment gateway when a payment-first signup checkout completes.
 * The auth module listens and materializes the account from the pending
 * registration, keeping the payment module free of any dependency on auth.
 */
export class RegistrationPaymentCompletedEvent {
  constructor(
    public readonly pendingRegistrationId: string,
    public readonly subscription: RegistrationSubscriptionInfo,
  ) {}
}
