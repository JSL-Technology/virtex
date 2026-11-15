import type { BillingPeriod } from '../saas/enums/billing-period.enum';

/** What a person asked for when they chose a plan inside the product. */
export interface StartPlanChangeRequest {
  organizationId: string;
  /** Who asked: recorded on the plan history when the change lands. */
  actorUserId: string;
  userEmail: string;
  /** The provider's price for the chosen plan and period, resolved server-side from the plan. */
  priceId: string;
  /** Where the browser returns after paying for a NEW subscription (carries the session id). */
  successUrl: string;
  /** Where the browser returns when the person backs out. */
  cancelUrl: string;
  /** Where the browser returns after confirming a change to the subscription it already has. */
  planChangedUrl: string;
}

/**
 * Where to send the browser to finish a plan change, and which of the two flows it is.
 *
 * `checkout` buys a subscription — for an organization that has none in force. `subscription_update`
 * changes the price of the subscription it already has, confirmed on the provider's page with the
 * proration shown. Buying a second subscription beside a live one bills the customer twice.
 */
export interface PlanChangeStart {
  flow: 'checkout' | 'subscription_update';
  url: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface CreateRegistrationCheckoutDto {
  email: string;
  priceId: string;
  planSlug: string;
  trialPeriodDays?: number | null;
  successUrl: string;
  cancelUrl: string;
  /** Provider metadata is string-valued; the pending registration travels in it. */
  metadata?: Record<string, string>;
  /**
   * ISO 4217 currency the subscription should be billed in.
   *
   * Stripe resolves it against the Price's `currency_options`, so one Price serves every market
   * and the amounts are configured where prices belong — in Stripe — rather than duplicated in a
   * per-country table here. Omitted, the Price's default currency applies, which is what happened
   * for every customer in all nineteen markets: everyone was billed in USD.
   */
  currency?: string;
  /** ISO 3166-1 alpha-2, for tax determination. */
  countryCode?: string;
  /** The buyer's own tax identifier, so the invoice Stripe issues carries it. */
  taxId?: { type: string; value: string } | null;
}

export interface CheckoutSessionInfo {
  /** Stripe Checkout session status: open | complete | expired */
  status: string;
  /** payment_status: paid | unpaid | no_payment_required (trials) */
  paymentStatus: string;
  customerId: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  pendingRegistrationId: string | null;
  planSlug: string | null;
}

export interface WebhookResult {
  processed: boolean;
  eventId: string;
  type: string;
}

export interface BillingPaymentMethod {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/**
 * Who manages a subscription: the payment provider; the platform itself (a plan granted, a trial,
 * a subscription recorded before the provider was connected), with no card to change; or the
 * parent company it is billed through, whose billing this company can see but not manage.
 */
export type BillingManager = 'provider' | 'platform' | 'parent_organization';

export interface BillingSubscription {
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  managedBy: BillingManager;
}

export interface BillingOverview {
  plan: {
    slug: string;
    name: string;
    monthlyPrice: number | null;
    /** ISO 4217 the tenant is actually billed in. */
    currency: string;
    /** Minor units per unit of `currency` (1 for CLP/PYG, 100 otherwise). */
    minorUnits: number;
  } | null;
  subscription: BillingSubscription | null;
  paymentMethod: BillingPaymentMethod | null;
  /** The company this one is billed through, when it does not manage its own billing. */
  billedThrough: { organizationId: string; name: string } | null;
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  date: string;
  /** The provider's own line description; `null` when it has none, and the screen words one. */
  description: string | null;
  amount: number;
  currency: string;
  status: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
}

/**
 * The payment provider, as the product needs it. One adapter per provider; one is bound per process.
 *
 * An abstract class rather than an interface so it is its own injection token: the gateway used to
 * be bound to the string `'PAYMENT_GATEWAY'`, which no compiler checks on either side.
 */
export abstract class PaymentGateway {
  /**
   * The processor's price identifier for a plan and billing period, or null when the plan cannot
   * be bought in that period. Asked of the gateway rather than read from the plan row, because the
   * identifier belongs to whichever processor is configured.
   */
  abstract priceIdFor(
    plan: { slug: string; monthlyPriceId?: string | null; annualPriceId?: string | null },
    period: BillingPeriod,
  ): string | null;

  /** Change an organization's plan: buy a subscription if none is in force, change it otherwise. */
  abstract startPlanChange(request: StartPlanChangeRequest): Promise<PlanChangeStart>;

  abstract createRegistrationCheckoutSession(dto: CreateRegistrationCheckoutDto): Promise<CheckoutSessionResult>;

  abstract getCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo>;

  abstract handleWebhook(payload: Buffer, signature: string): Promise<WebhookResult>;

  abstract getBillingOverview(organizationId: string): Promise<BillingOverview>;

  /** Record a checkout the browser came back from, without waiting for the webhook. */
  abstract confirmOrganizationCheckout(organizationId: string, sessionId: string): Promise<BillingOverview>;

  /**
   * Record the subscription as the provider has it now — after the browser returns from changing it
   * there, without waiting for the webhook. Moves no money and grants nothing the provider did not.
   */
  abstract reconcileSubscription(organizationId: string): Promise<BillingOverview>;

  abstract getInvoices(organizationId: string, limit?: number): Promise<BillingInvoice[]>;

  abstract createBillingPortalSession(organizationId: string, returnUrl: string): Promise<{ url: string }>;

  /**
   * Undo a subscription that was paid for but whose account could not be created.
   *
   * Signup charges before the account exists, so a materialisation failure leaves a live
   * subscription attached to nothing and a customer billed for a product they cannot reach —
   * and it would keep renewing. Cancelling and refunding is the compensating action that was
   * missing entirely.
   */
  abstract voidOrphanedSubscription(subscriptionId: string, reason: string): Promise<void>;
}
