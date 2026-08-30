
export interface CreateCheckoutSessionDto {
  organizationId: string;
  userEmail: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, any>;
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
  metadata?: Record<string, any>;
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

export interface BillingSubscription {
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingOverview {
  plan: {
    slug: string;
    name: string;
    monthlyPrice: number | null;
  } | null;
  subscription: BillingSubscription | null;
  paymentMethod: BillingPaymentMethod | null;
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  date: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
}

export interface PaymentGateway {
  createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<CheckoutSessionResult>;
  createRegistrationCheckoutSession(dto: CreateRegistrationCheckoutDto): Promise<CheckoutSessionResult>;
  getCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo>;
  handleWebhook(payload: Buffer, signature: string): Promise<WebhookResult>;
  getBillingOverview(organizationId: string): Promise<BillingOverview>;
  confirmOrganizationCheckout(organizationId: string, sessionId: string): Promise<BillingOverview>;
  getInvoices(organizationId: string, limit?: number): Promise<BillingInvoice[]>;
  createBillingPortalSession(organizationId: string, returnUrl: string): Promise<{ url: string }>;
}
