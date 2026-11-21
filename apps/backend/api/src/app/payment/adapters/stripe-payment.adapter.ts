import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Stripe from 'stripe';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  BillingInvoice,
  BillingOverview,
  CheckoutSessionInfo,
  CheckoutSessionResult,
  CreateRegistrationCheckoutDto,
  PaymentGateway,
  PlanChangeStart,
  StartPlanChangeRequest,
  WebhookResult,
} from '../payment-gateway.port';
import { STRIPE_CLIENT } from '../stripe/stripe.provider';
import { isDevLikeEnvironment } from '../../config/environment';
import { Organization } from '../../organizations/entities/organization.entity';
import type { Plan } from '../../saas/entities/plan.entity';
import { SaasService } from '../../saas/saas.service';
import { SAAS_PLANS, minorUnitFactor } from '../../saas/saas.config';
import { PlanChangeReason, SubscriptionStanding } from '../../saas/plan-change';
import { RegistrationPaymentCompletedEvent } from '../events/registration-payment-completed.event';
import { BadRequestError, ConflictError, ServiceUnavailableError } from '../../i18n/localized.exception';
import type { BillingPeriod } from '../../saas/enums/billing-period.enum';
import { knownMarket } from '../../markets';
import { BillingStateService, type SubscriptionSnapshot } from '../billing-state.service';
import { overviewFromRecord } from '../billing-overview';

/** What a webhook leaves to do once its transaction has committed, and only then. */
interface AfterCommit {
  /** Organizations whose cached entitlement is stale. */
  stale: Set<string>;
  /** Notifications about a change that was actually recorded. */
  events: Array<{ name: string; payload: object }>;
}

/** The id of a Stripe reference, whether it arrived expanded or as a bare id. */
const idOf = (reference: string | { id: string } | null | undefined): string | null =>
  typeof reference === 'string' ? reference : reference?.id ?? null;

@Injectable()
export class StripePaymentAdapter implements PaymentGateway, OnModuleInit {
  private readonly logger = new Logger(StripePaymentAdapter.name);

  constructor(
    // `null` when STRIPE_SECRET_KEY is not set; every method that needs it goes through `ensureStripe`.
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe | null,
    @InjectRepository(Organization) private readonly organizationRepository: Repository<Organization>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly saasService: SaasService,
    private readonly billingState: BillingStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  priceIdFor(
    plan: { monthlyPriceId?: string | null; annualPriceId?: string | null },
    period: BillingPeriod,
  ): string | null {
    return SaasService.priceIdFor(plan, period);
  }

  async onModuleInit(): Promise<void> {
    await this.verifyPriceCatalog();
  }

  /**
   * Assert that every amount we DISPLAY is the amount Stripe will CHARGE.
   *
   * The catalogue in `SAAS_PLANS` is what the plan cards and the checkout both quote from, and
   * Stripe bills from its own Price. Two numbers in two systems drift by default, and the way
   * that drift surfaces is a customer being charged something other than what they agreed to —
   * a chargeback and a consumer-protection problem, not a bug report.
   *
   * So it is checked at boot, against the live Price:
   *   - production: a mismatch aborts startup. Serving a wrong price is worse than not serving.
   *   - elsewhere: logged loudly, because Stripe is usually not configured in development.
   *
   * A currency present in our table but absent from the Price's `currency_options` is the same
   * class of fault: `currencyForCountry` would offer it and Checkout would fall back to the
   * Price's default currency.
   */
  private async verifyPriceCatalog(): Promise<void> {
    if (!this.stripe) {
      this.logger.warn(
        { event: 'price_catalog_unverified' },
        'Stripe is not configured; plan prices could not be verified against the payment processor.',
      );
      return;
    }

    const problems: string[] = [];

    for (const plan of SAAS_PLANS) {
      // Both billing periods are verified. The annual one is optional — a plan with no annual
      // Price is monthly-only and the catalogue says so — but where it exists, its amounts must
      // agree with ours exactly as the monthly ones do.
      const periods: Array<{ label: string; priceId?: string; amounts: Readonly<Record<string, number>>; required: boolean }> = [
        { label: 'monthly', priceId: this.configService.get<string>(plan.monthlyPriceIdVar), amounts: plan.monthlyPrices, required: true },
        { label: 'annual', priceId: this.configService.get<string>(plan.annualPriceIdVar), amounts: plan.annualPrices, required: false },
      ];

      for (const period of periods) {
        if (!period.priceId) {
          if (period.required) {
            problems.push(`${plan.slug}: ${plan.monthlyPriceIdVar} is not set`);
          } else if (Object.keys(period.amounts).length > 0) {
            // An amount with no Price to charge it from is worse than no annual plan at all: the
            // catalogue would quote a yearly figure that checkout cannot honour.
            problems.push(
              `${plan.slug}: annual amounts are configured but ${plan.annualPriceIdVar} is not set`,
            );
          }
          continue;
        }

        let price: Stripe.Price;
        try {
          price = await this.stripe.prices.retrieve(period.priceId, { expand: ['currency_options'] });
        } catch (error) {
          problems.push(
            `${plan.slug}/${period.label}: price ${period.priceId} could not be read (${(error as Error).message})`,
          );
          continue;
        }

        for (const [currency, expected] of Object.entries(period.amounts)) {
          const code = currency.toLowerCase();
          const actual =
            code === price.currency
              ? price.unit_amount
              : price.currency_options?.[code]?.unit_amount ?? null;

          if (actual === null || actual === undefined) {
            problems.push(
              `${plan.slug}/${period.label}: we quote ${currency} but price ${period.priceId} has no amount for it`,
            );
            continue;
          }
          if (actual !== expected) {
            const factor = minorUnitFactor(currency);
            problems.push(
              `${plan.slug}/${period.label}/${currency}: we display ${expected / factor} but Stripe charges ${actual / factor}`,
            );
          }
        }
      }
    }

    if (problems.length === 0) {
      this.logger.log({ event: 'price_catalog_verified' }, 'Plan prices match Stripe.');
      return;
    }

    const summary = `Plan prices disagree with Stripe:\n  - ${problems.join('\n  - ')}`;
    // The project's allow-list: a price catalogue that disagrees with Stripe is fatal in every
    // real deployment, not only in one spelled `production`. Charging the wrong amount is not a
    // staging-only problem.
    if (!isDevLikeEnvironment()) {
      this.logger.error({ event: 'price_catalog_mismatch' }, summary);
      throw new Error(`FATAL: ${summary}`);
    }
    this.logger.warn({ event: 'price_catalog_mismatch' }, summary);
  }

  /**
   * Ensures the Stripe SDK was initialized. The provider returns `null` when
   * STRIPE_SECRET_KEY is not configured; surfacing a clear 503 here beats an
   * opaque "cannot read properties of null" crash deep in the flow.
   */
  private ensureStripe(): Stripe {
    if (!this.stripe) {
      this.logger.error('Stripe is not configured (missing STRIPE_SECRET_KEY).');
      throw new ServiceUnavailableError('payment.not_configured');
    }
    return this.stripe;
  }

  /**
   * The payment methods a market actually uses.
   *
   * `payment_method_types: ['card']` was hardcoded, which is a card-only funnel. In the markets
   * this product is sold in, that is not a subset of buyers — in Brazil PIX and Boleto carry the
   * majority of B2B SME payments, in Mexico OXXO and SPEI do, in Colombia PSE does. A signup that
   * validates a CNPJ, a régime tributário and an Inscrição Estadual and then only accepts a card
   * loses the customer at the last step.
   *
   * Returning `undefined` lets Stripe decide from what the account has enabled and what the
   * currency and customer location support, which is the behaviour that keeps working as methods
   * are turned on in the Stripe dashboard. The explicit lists exist so a market whose method
   * requires opting in is not silently omitted.
   */
  private paymentMethodsFor(countryCode?: string | null): Stripe.Checkout.SessionCreateParams.PaymentMethodType[] | undefined {
    // The market says which methods its companies pay with (`markets/<cc>/payments.ts`); this
    // adapter used to keep its own table of country codes for it.
    const methods = knownMarket(countryCode ?? undefined)?.payments.subscriptionCheckout.stripe;
    return methods?.length ? (methods as Stripe.Checkout.SessionCreateParams.PaymentMethodType[]) : undefined;
  }

  /**
   * Tax treatment of a subscription checkout, the same for a signup and for an existing customer.
   *
   * Stripe Tax is a property of the Stripe ACCOUNT (a registered origin address + activated
   * Stripe Tax), not of this code. Where that setup is absent — every local run by default —
   * `automatic_tax` makes Stripe reject the ENTIRE checkout ("You must have a valid head office
   * address…"). The flag defaults on in production and off in development (see env.validation.ts).
   *
   * Selling software to a Mexican or Colombian company obliges US to issue that company a
   * compliant invoice with its tax identifier on it — our own compliance, not the customer's.
   * `billing_address_collection: 'required'` is here because `automatic_tax` derives the rate
   * from that address, so the three move together; and for a customer that already exists, Stripe
   * keeps the address and the tax id collected only when told to update it.
   */
  private taxCollection(existingCustomer: boolean): Partial<Stripe.Checkout.SessionCreateParams> {
    if (this.configService.get<boolean>('STRIPE_TAX_ENABLED') !== true) return {};
    return {
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: 'required',
      ...(existingCustomer ? { customer_update: { address: 'auto', name: 'auto' } } : {}),
    };
  }

  /**
   * Change an organization's plan: change the subscription it has, or buy one if it has none.
   *
   * Every in-app plan change used to open a Checkout in `subscription` mode — which CREATES a
   * subscription. For a customer who already had one (every tenant does: signup is payment-first)
   * that was a second subscription beside the first. Both billed; the organization pointed at the
   * newer one, so the older one's events matched no organization and it kept charging, unseen, for
   * as long as the card lasted.
   *
   * A subscription in force now has its price changed in place, on the provider's own confirmation
   * page, where the customer sees the proration before agreeing to it. One that still owes money
   * is settled first. Only an organization with no subscription in force goes to Checkout.
   */
  async startPlanChange(request: StartPlanChangeRequest): Promise<PlanChangeStart> {
    const stripe = this.ensureStripe();
    const organization = await this.organizationRepository.findOne({ where: { id: request.organizationId } });
    if (!organization) {
      throw new BadRequestError('payment.organization_not_found');
    }

    const current = organization.externalSubscriptionId
      ? await this.retrieveSubscription(organization.externalSubscriptionId)
      : null;
    if (current && SubscriptionStanding.UNSETTLED.has(current.status)) {
      throw new ConflictError('payment.subscription_must_be_settled_first', { status: current.status });
    }
    if (current && SubscriptionStanding.IN_FORCE.has(current.status)) {
      return this.changeSubscriptionPrice(stripe, current, request);
    }
    return this.startCheckout(stripe, organization, request);
  }

  private async changeSubscriptionPrice(
    stripe: Stripe,
    subscription: Stripe.Subscription,
    request: StartPlanChangeRequest,
  ): Promise<PlanChangeStart> {
    const item = await this.planItemOf(subscription);
    if (!item) {
      // A subscription none of whose prices is a plan was not sold by this product.
      throw new ConflictError('payment.subscription_bills_no_plan');
    }
    if (item.price.id === request.priceId) {
      throw new ConflictError('payment.plan_already_active');
    }
    const customer = idOf(subscription.customer);
    if (!customer) {
      throw new ConflictError('payment.subscription_bills_no_plan');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: request.cancelUrl,
      flow_data: {
        type: 'subscription_update_confirm',
        subscription_update_confirm: {
          subscription: subscription.id,
          items: [{ id: item.id, price: request.priceId, quantity: item.quantity ?? 1 }],
        },
        after_completion: { type: 'redirect', redirect: { return_url: request.planChangedUrl } },
      },
    });
    return { flow: 'subscription_update', url: session.url };
  }

  private async startCheckout(
    stripe: Stripe,
    organization: Organization,
    request: StartPlanChangeRequest,
  ): Promise<PlanChangeStart> {
    let customerId = organization.externalCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: request.userEmail,
        name: organization.legalName,
        metadata: { organizationId: organization.id },
      });
      customerId = customer.id;
      await this.organizationRepository.update({ id: organization.id }, { externalCustomerId: customerId });
    }

    const plan = await this.saasService.planForPrice(request.priceId);
    if (!plan) {
      throw new BadRequestError('payment.no_valid_plan_specified_price_id');
    }
    // Who asked travels with the subscription, so its history names them whichever of the
    // browser's return and the webhook records it first.
    const metadata = { organizationId: organization.id, planSlug: plan.slug, initiatedBy: request.actorUserId };
    const methods = this.paymentMethodsFor(organization.country);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      ...(methods ? { payment_method_types: methods } : {}),
      line_items: [{ price: request.priceId, quantity: 1 }],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      // Bill in the market's own currency, exactly as the signup does. Without it an existing
      // customer resubscribing was charged in the Price's default currency, whatever their market.
      currency: SaasService.currencyForCountry(organization.country ?? undefined).toLowerCase(),
      ...this.taxCollection(true),
      subscription_data: { metadata },
      metadata,
    });

    if (!session.url) {
      throw new BadRequestError('payment.failed_create_stripe_session_url');
    }
    return { flow: 'checkout', url: session.url };
  }

  /**
   * Creates a Checkout session for a signup that has NO account/customer yet.
   * Stripe creates the customer from `customer_email`; the pending registration
   * id travels in metadata so the webhook (and the confirm endpoint) can
   * materialize the account after payment. Trials/promotions are honored when
   * configured, so the same flow supports immediate charge or future trials.
   */
  async createRegistrationCheckoutSession(dto: CreateRegistrationCheckoutDto): Promise<CheckoutSessionResult> {
    const stripe = this.ensureStripe();

    if (!dto.priceId) {
      throw new BadRequestError('payment.no_valid_plan_specified_price_id');
    }

    const metadata = {
      planSlug: dto.planSlug,
      ...(dto.metadata || {}),
    };

    const methods = this.paymentMethodsFor(dto.countryCode);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      // Omitted entirely when the market has no explicit list, so Stripe offers whatever the
      // account has enabled for that currency and country. Pinning `['card']` excluded PIX,
      // Boleto, OXXO, SPEI and PSE from every Latin American signup.
      ...(methods ? { payment_method_types: methods } : {}),
      customer_email: dto.email,
      allow_promotion_codes: true,
      line_items: [{ price: dto.priceId, quantity: 1 }],
      success_url: dto.successUrl,
      cancel_url: dto.cancelUrl,
      // Bill in the market's own currency. Stripe resolves it against the Price's
      // `currency_options`; without it every customer in all nineteen markets was charged in the
      // Price's default currency, i.e. USD.
      ...(dto.currency ? { currency: dto.currency.toLowerCase() } : {}),
      ...this.taxCollection(false),
      subscription_data: {
        ...(dto.trialPeriodDays && dto.trialPeriodDays > 0
          ? { trial_period_days: dto.trialPeriodDays }
          : {}),
        metadata,
      },
      metadata,
    });

    if (!session.url) {
      throw new BadRequestError('payment.failed_create_stripe_session_url');
    }

    return { sessionId: session.id, url: session.url };
  }

  /**
   * Retrieves a Checkout session for server-side reconciliation after the user
   * returns from Stripe (so signup works even if the webhook is delayed).
   */
  async getCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo> {
    const stripe = this.ensureStripe();

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    const subscription = (session.subscription && typeof session.subscription !== 'string')
      ? (session.subscription as Stripe.Subscription)
      : null;

    return {
      status: session.status || 'open',
      paymentStatus: session.payment_status || 'unpaid',
      customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
      subscriptionId: subscription?.id ?? (typeof session.subscription === 'string' ? session.subscription : null),
      subscriptionStatus: subscription?.status ?? null,
      currentPeriodEnd: subscription ? this.periodEndOf(subscription) : null,
      pendingRegistrationId: session.metadata?.pendingRegistrationId ?? null,
      planSlug: session.metadata?.planSlug ?? null,
    };
  }

  /**
   * Reconciles an organization's plan after the user returns from Checkout,
   * without waiting for the webhook (so it works in any environment). Verifies
   * the session belongs to this organization, then applies the subscription +
   * plan. Idempotent — safe to call alongside the webhook.
   */
  async confirmOrganizationCheckout(organizationId: string, sessionId: string): Promise<BillingOverview> {
    const stripe = this.ensureStripe();

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });

    // Security: only reconcile sessions that were created FOR this org — fail closed.
    //
    // The condition used to be `if (metadata.organizationId && mismatch)`, so a session with no
    // `organizationId` in its metadata skipped the check entirely. Registration checkouts are
    // exactly that: they carry `{ planSlug, pendingRegistrationId }` and no organization,
    // because no organization exists yet. Any member of any tenant could therefore take the
    // session id of a signup they had paid for themselves and reconcile it onto their employer,
    // overwriting `externalCustomerId` and `externalSubscriptionId` — pointing the tenant's
    // billing relationship, its invoices and its portal access at their own Stripe customer.
    if (session.metadata?.organizationId !== organizationId) {
      this.logger.warn(
        {
          event: 'checkout_confirm_org_mismatch',
          organizationId,
          sessionOrganizationId: session.metadata?.organizationId ?? null,
        },
        '[SECURITY] Checkout confirmation presented a session that does not belong to this organization.',
      );
      throw new BadRequestError('payment.payment_session_does_not_belong_organization');
    }

    const settled = session.status === 'complete' &&
      (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');

    if (settled) {
      const subscriptionId = idOf(session.subscription as string | Stripe.Subscription | null);
      const subscription =
        session.subscription && typeof session.subscription !== 'string'
          ? (session.subscription as Stripe.Subscription)
          : subscriptionId
            ? await this.retrieveSubscription(subscriptionId)
            : null;
      if (!subscription) {
        this.logger.error(
          { event: 'checkout_confirm_without_subscription', organizationId, sessionId },
          '[BILLING] A settled subscription checkout carried no subscription.',
        );
        return this.getBillingOverview(organizationId);
      }

      const snapshot = await this.snapshotOf(subscription);
      const stale = await this.dataSource.transaction(async (manager) => {
        const group = await this.billingState.billedWith(manager, organizationId);
        if (!group.some((organization) => organization.id === organizationId)) {
          throw new BadRequestError('payment.organization_not_found');
        }
        return this.billingState.record(manager, group, snapshot, {
          reason: PlanChangeReason.CHECKOUT,
          changedBy: session.metadata?.initiatedBy ?? null,
        });
      });
      await this.invalidate(stale);
    }

    return this.getBillingOverview(organizationId);
  }

  /**
   * Record the subscription as Stripe has it now, for the browser coming back from changing it on
   * Stripe's own page. The webhook says the same thing a moment later — or never, in development —
   * and recording it twice is a no-op.
   */
  async reconcileSubscription(organizationId: string): Promise<BillingOverview> {
    const organization = await this.organizationRepository.findOne({ where: { id: organizationId } });
    if (!organization) {
      throw new BadRequestError('payment.organization_not_found');
    }
    if (this.stripe && organization.externalSubscriptionId) {
      const subscription = await this.retrieveSubscription(organization.externalSubscriptionId);
      if (subscription) {
        const snapshot = await this.snapshotOf(subscription);
        const stale = await this.dataSource.transaction(async (manager) =>
          this.billingState.record(manager, await this.billingState.billedWith(manager, organizationId), snapshot, {
            reason: PlanChangeReason.PROVIDER_UPDATE,
            changedBy: null,
          }),
        );
        await this.invalidate(stale);
      }
    }
    return this.getBillingOverview(organizationId);
  }

  /**
   * Cancel and refund a subscription whose account was never created.
   *
   * Payment-first signup takes the money before the organization exists, so when
   * `completePendingRegistration` fails the customer is charged for something they cannot use —
   * and, left alone, is charged again next month. Nothing did anything about that: the failure
   * rolled back the transaction and the subscription kept running.
   *
   * Cancellation comes first and the refund is best-effort after it: stopping the recurring
   * charge is the part that must not be missed, and a refund can be issued by hand later, while
   * an uncancelled subscription quietly bills a stranger every month.
   *
   * Errors are logged, never thrown. This runs inside a failure path already; making the
   * compensation itself able to fail the request would replace one bad outcome with two.
   */
  async voidOrphanedSubscription(subscriptionId: string, reason: string): Promise<void> {
    if (!this.stripe || !subscriptionId) return;

    try {
      await this.stripe.subscriptions.cancel(subscriptionId, {
        prorate: false,
      });
      this.logger.warn(
        { event: 'orphaned_subscription_cancelled', subscriptionId, reason },
        '[BILLING] Cancelled a subscription whose account could not be created.',
      );
    } catch (error) {
      this.logger.error(
        { event: 'orphaned_subscription_cancel_failed', subscriptionId, reason },
        `[BILLING] Could not cancel orphaned subscription: ${(error as Error).message}. Resolve it by hand.`,
      );
      return;
    }

    try {
      const invoices = await this.stripe.invoices.list({ subscription: subscriptionId, limit: 1 });
      const charged = invoices.data.find((invoice) => (invoice.amount_paid ?? 0) > 0);
      const paymentIntent = (charged as unknown as { payment_intent?: string | null })?.payment_intent;
      if (typeof paymentIntent === 'string') {
        await this.stripe.refunds.create({
          payment_intent: paymentIntent,
          reason: 'requested_by_customer',
          metadata: { orphanedSubscriptionId: subscriptionId, failure: reason.slice(0, 200) },
        });
        this.logger.warn(
          { event: 'orphaned_subscription_refunded', subscriptionId },
          '[BILLING] Refunded the charge for an account that could not be created.',
        );
      }
    } catch (error) {
      this.logger.error(
        { event: 'orphaned_subscription_refund_failed', subscriptionId },
        `[BILLING] Subscription cancelled but the refund failed: ${(error as Error).message}. Issue it by hand.`,
      );
    }
  }

  /**
   * The organization's plan (source of truth: our records) plus the live subscription and default
   * payment method from Stripe. With Stripe unconfigured, or no customer yet, the recorded plan and
   * standing are still returned, so the screen renders the current state without a hard failure.
   */
  async getBillingOverview(organizationId: string): Promise<BillingOverview> {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
      relations: ['plan'],
    });
    if (!organization) {
      throw new BadRequestError('payment.organization_not_found');
    }

    // The platform's own record of the subscription, until the provider says otherwise. It was
    // left null whenever Stripe had nothing to say, so a tenant with an active plan read
    // «Enterprise» and «Sin suscripción activa» side by side (QA M-10). The amount is quoted in
    // what the tenant is actually billed in, resolved exactly as the signup did.
    const overview = overviewFromRecord(organization, 'platform');

    // Without Stripe configured or a linked customer there is nothing live to fetch.
    if (!this.stripe || !organization.externalCustomerId) {
      return overview;
    }

    try {
      // The card can live in either of two places after Checkout. Hold the subscription's default
      // so it can stand in when the customer-level one is absent.
      let subscriptionDefaultPm: Stripe.PaymentMethod | null = null;
      if (organization.externalSubscriptionId) {
        const sub = await this.stripe.subscriptions.retrieve(organization.externalSubscriptionId, {
          expand: ['default_payment_method'],
        });
        const periodEnd = this.periodEndOf(sub);
        overview.subscription = {
          status: sub.status,
          currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
          managedBy: 'provider',
        };
        subscriptionDefaultPm =
          sub.default_payment_method && typeof sub.default_payment_method !== 'string'
            ? (sub.default_payment_method as Stripe.PaymentMethod)
            : null;
      }

      const customer = await this.stripe.customers.retrieve(organization.externalCustomerId, {
        expand: ['invoice_settings.default_payment_method'],
      });

      const customerDefaultPm =
        customer && !(customer as Stripe.DeletedCustomer).deleted
          ? ((customer as Stripe.Customer).invoice_settings
              ?.default_payment_method as Stripe.PaymentMethod | null)
          : null;

      // Prefer the customer's default, but fall back to the subscription's: Checkout in
      // subscription mode reliably sets the latter and only sometimes the former, so reading the
      // customer alone left a freshly-entered card invisible until a webhook copied it across —
      // which, in local development, never arrives.
      const pm = customerDefaultPm?.card ? customerDefaultPm : subscriptionDefaultPm;
      if (pm?.card) {
        overview.paymentMethod = {
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year,
        };
      }
    } catch (e) {
      // A Stripe hiccup must not break the billing page — log and return what we have.
      this.logger.warn(`Failed to fetch live billing data for org ${organizationId}: ${(e as Error).message}`);
    }

    return overview;
  }

  async getInvoices(organizationId: string, limit = 12): Promise<BillingInvoice[]> {
    const organization = await this.organizationRepository.findOne({ where: { id: organizationId } });
    if (!organization) {
      throw new BadRequestError('payment.organization_not_found');
    }

    if (!this.stripe || !organization.externalCustomerId) {
      return [];
    }

    try {
      const invoices = await this.stripe.invoices.list({
        customer: organization.externalCustomerId,
        limit,
      });

      return invoices.data.map((inv) => ({
        id: inv.id,
        number: inv.number ?? null,
        date: new Date(inv.created * 1000).toISOString(),
        // Stripe's own line description, or nothing: the screen words a missing one in the
        // reader's language. It used to be filled in here, in Spanish, for every reader.
        description: inv.lines?.data?.[0]?.description || null,
        amount: inv.amount_paid ?? inv.amount_due ?? 0,
        currency: (inv.currency || 'usd').toUpperCase(),
        status: inv.status || 'unknown',
        pdfUrl: inv.invoice_pdf ?? null,
        hostedUrl: inv.hosted_invoice_url ?? null,
      }));
    } catch (e) {
      this.logger.warn(`Failed to fetch invoices for org ${organizationId}: ${(e as Error).message}`);
      return [];
    }
  }

  async createBillingPortalSession(organizationId: string, returnUrl: string): Promise<{ url: string }> {
    const stripe = this.ensureStripe();

    const organization = await this.organizationRepository.findOne({ where: { id: organizationId } });
    if (!organization) {
      throw new BadRequestError('payment.organization_not_found');
    }
    if (!organization.externalCustomerId) {
      throw new BadRequestError('payment.no_active_subscription_manage');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: organization.externalCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  async handleWebhook(payload: Buffer, signature: string): Promise<WebhookResult> {
      const stripe = this.ensureStripe();
      const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
      if (!webhookSecret) {
        this.logger.error('Stripe webhook secret is not configured (missing STRIPE_WEBHOOK_SECRET).');
        throw new ServiceUnavailableError('payment.webhook_not_configured');
      }
      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      } catch (err) {
        this.logger.error(`Webhook signature verification failed: ${(err as Error).message}`);
        throw new BadRequestError('payment.webhook_signature_verification_failed');
      }

      // What the event is about, read from Stripe BEFORE the transaction opens: a network call
      // inside it holds a connection — and the organizations' row locks — for as long as Stripe
      // takes to answer. It is the subscription as it is NOW, not as the event's payload froze it:
      // Stripe does not deliver events in order, and an older payload applied after a newer one
      // would put back a status, a period or a plan the customer has already left.
      const subscription = await this.subscriptionBehind(event);
      const after: AfterCommit = { stale: new Set(), events: [] };

      await this.dataSource.transaction(async (manager) => {
        // Claim the event before doing anything with it. Two deliveries of one event used to both
        // pass a `findOne`, do the work, and the second fail on the primary key at the end — rolled
        // back, answered with an error and redelivered (IAM-P3). The insert claims it atomically: a
        // concurrent delivery waits on this row and, once this commits, finds it taken; if this
        // rolls back, the claim goes with it and the next delivery does the work.
        const claimed: Array<{ id: string }> = await manager.query(
          `INSERT INTO "payment_webhook_events" ("id") VALUES ($1) ON CONFLICT ("id") DO NOTHING RETURNING "id"`,
          [event.id],
        );
        if (claimed.length === 0) {
          this.logger.log(`Event ${event.id} already processed. Skipping.`);
          return;
        }

        this.logger.log(`Received Stripe event: ${event.type}`);

        switch (event.type) {
          case 'checkout.session.completed':
            await this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session, subscription, manager, after);
            break;

          case 'customer.subscription.created':
          case 'customer.subscription.updated':
          case 'customer.subscription.deleted':
            if (subscription) await this.onSubscriptionChanged(subscription, manager, after);
            break;

          // Dunning. Without these the product could not tell a paying customer from one whose
          // card has been failing for a fortnight: the subscription row only moved when Stripe
          // eventually changed the subscription's own status, after the whole retry schedule.
          case 'invoice.payment_failed':
          case 'invoice.paid':
            await this.onInvoice(event.data.object as Stripe.Invoice, event.type, subscription, manager, after);
            break;

          default:
            this.logger.log(`Unhandled event type: ${event.type}`);
        }
      });

      await this.runAfterCommit(after);
      return { processed: true, eventId: event.id, type: event.type };
  }

  /** The subscription an event is about, as Stripe has it now; `null` for an event about none. */
  private async subscriptionBehind(event: Stripe.Event): Promise<Stripe.Subscription | null> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.retrieveSubscription(idOf((event.data.object as Stripe.Checkout.Session).subscription));
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return this.retrieveSubscription((event.data.object as Stripe.Subscription).id);
      case 'invoice.payment_failed':
      case 'invoice.paid':
        return this.retrieveSubscription(this.subscriptionIdOf(event.data.object as Stripe.Invoice));
      default:
        return null;
    }
  }

  private async onCheckoutCompleted(
    session: Stripe.Checkout.Session,
    subscription: Stripe.Subscription | null,
    manager: EntityManager,
    after: AfterCommit,
  ): Promise<void> {
    const metadata = session.metadata ?? {};
    const customerId = idOf(session.customer);
    if (!subscription || !customerId) {
      this.logger.error(
        { event: 'checkout_completed_without_subscription', sessionId: session.id },
        '[BILLING] A subscription checkout completed without a subscription or a customer.',
      );
      return;
    }

    // Payment-first signup: no organization exists yet. The auth side materializes the account
    // from the pending registration, and it is awaited here, before this transaction records the
    // event: if the account cannot be created the event is not marked processed and Stripe
    // delivers it again. Idempotent there.
    if (metadata['pendingRegistrationId']) {
      await this.eventEmitter.emitAsync(
        'registration.payment_completed',
        new RegistrationPaymentCompletedEvent(metadata['pendingRegistrationId'], {
          customerId,
          subscriptionId: subscription.id,
          status: subscription.status,
          currentPeriodEnd: this.periodEndOf(subscription),
        }),
      );
      return;
    }

    const organizationId = metadata['organizationId'];
    const group = organizationId ? await this.billingState.billedWith(manager, organizationId) : [];
    const anchor = group.find((organization) => organization.id === organizationId);
    if (!anchor) {
      this.logger.error(
        { event: 'checkout_completed_unknown_organization', sessionId: session.id, organizationId: organizationId ?? null },
        '[BILLING] A paid checkout names no organization of ours.',
      );
      return;
    }
    // Our own checkout set the customer before the session existed; one naming a different
    // customer was not created for this organization.
    if (anchor.externalCustomerId && anchor.externalCustomerId !== customerId) {
      this.logger.warn(
        { event: 'checkout_completed_customer_mismatch', organizationId: anchor.id, sessionId: session.id },
        '[SECURITY] A checkout for this organization was paid by another customer; not applied.',
      );
      return;
    }

    const stale = await this.billingState.record(manager, group, await this.snapshotOf(subscription), {
      reason: PlanChangeReason.CHECKOUT,
      changedBy: metadata['initiatedBy'] ?? null,
    });
    stale.forEach((id) => after.stale.add(id));
  }

  /**
   * The subscription changed at Stripe — its status, its period, or its PRICE: the in-app plan
   * change the customer confirmed on Stripe's page, the portal, or an operator in the dashboard.
   *
   * The price used to be ignored here, so a customer who moved from Starter to Pro was charged for
   * Pro and kept Starter's limits; one who moved down kept the higher plan for free.
   */
  private async onSubscriptionChanged(
    subscription: Stripe.Subscription,
    manager: EntityManager,
    after: AfterCommit,
  ): Promise<void> {
    const group = await this.billingState.organizationsOn(manager, subscription.id);
    if (group.length === 0) {
      // A signup's subscription before its account exists, or a new checkout's before its
      // completion is recorded: the completion records it, with the state read then.
      this.logger.log(`Subscription ${subscription.id} bills no organization yet.`);
      return;
    }
    const stale = await this.billingState.record(manager, group, await this.snapshotOf(subscription), {
      reason: PlanChangeReason.PROVIDER_UPDATE,
      changedBy: null,
    });
    stale.forEach((id) => after.stale.add(id));
  }

  /**
   * A charge failed, or succeeded. The STATE comes from the subscription as it is now — invoice and
   * subscription events arrive in no guaranteed order — and the dunning window follows it; the
   * NOTIFICATION is about this invoice, and goes to the company that pays, not to every company
   * billed through it.
   */
  private async onInvoice(
    invoice: Stripe.Invoice,
    type: 'invoice.payment_failed' | 'invoice.paid',
    subscription: Stripe.Subscription | null,
    manager: EntityManager,
    after: AfterCommit,
  ): Promise<void> {
    if (!subscription) return;
    const group = await this.billingState.organizationsOn(manager, subscription.id);
    if (group.length === 0) {
      this.logger.warn(`${type} for subscription ${subscription.id}, which bills no organization.`);
      return;
    }
    const stale = await this.billingState.record(manager, group, await this.snapshotOf(subscription), {
      reason: PlanChangeReason.PROVIDER_UPDATE,
      changedBy: null,
    });
    stale.forEach((id) => after.stale.add(id));

    for (const payer of group) {
      if (await this.billingState.billingParentOf(manager, payer.id)) continue;
      after.events.push(
        type === 'invoice.payment_failed'
          ? {
              name: 'billing.payment_failed',
              payload: {
                organizationId: payer.id,
                invoiceId: invoice.id,
                amountDue: invoice.amount_due,
                currency: invoice.currency,
                attemptCount: invoice.attempt_count ?? 0,
                nextAttempt: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : null,
                gracePeriodEnd: payer.gracePeriodEnd,
              },
            }
          : {
              name: 'billing.payment_succeeded',
              payload: {
                organizationId: payer.id,
                invoiceId: invoice.id,
                amountPaid: invoice.amount_paid,
                currency: invoice.currency,
              },
            },
      );
    }
  }

  /**
   * Invalidate and notify once the change is committed — never before. Invalidating inside the
   * transaction let a concurrent request cache the OLD entitlement again before the new one was
   * visible; a notification sent from inside it announced a change a rollback could still undo.
   * The database is already right when this runs, so a cache outage is logged, not thrown: the
   * cached principal expires on its own, and failing would only make Stripe redeliver an event
   * that is now recorded as processed.
   */
  private async runAfterCommit(after: AfterCommit): Promise<void> {
    await this.invalidate([...after.stale]);
    for (const { name, payload } of after.events) this.eventEmitter.emit(name, payload);
  }

  private async invalidate(organizationIds: readonly string[]): Promise<void> {
    for (const id of organizationIds) {
      try {
        await this.saasService.clearOrganizationCache(id);
      } catch (error) {
        this.logger.error(
          { event: 'billing_cache_invalidation_failed', organizationId: id },
          `[BILLING] Billing changed but the cached entitlement could not be invalidated: ${(error as Error).message}`,
        );
      }
    }
  }

  /** The subscription by id, or `null` when there is none to read. */
  private async retrieveSubscription(subscriptionId: string | null): Promise<Stripe.Subscription | null> {
    if (!subscriptionId) return null;
    return this.ensureStripe().subscriptions.retrieve(subscriptionId);
  }

  /** Stripe's view of a subscription, in the shape every adapter records. */
  private async snapshotOf(subscription: Stripe.Subscription): Promise<SubscriptionSnapshot> {
    return {
      subscriptionId: subscription.id,
      customerId: idOf(subscription.customer),
      status: subscription.status,
      periodEnd: this.periodEndOf(subscription),
      plan: await this.planOf(subscription),
    };
  }

  /** The plan a subscription bills: that of its first item whose price is one of ours. */
  private async planOf(subscription: Stripe.Subscription): Promise<Plan | null> {
    for (const item of subscription.items?.data ?? []) {
      const plan = await this.saasService.planForPrice(item.price?.id);
      if (plan) return plan;
    }
    if (subscription.items?.data?.length) {
      this.logger.error(
        {
          event: 'subscription_price_unknown',
          subscriptionId: subscription.id,
          prices: subscription.items.data.map((item) => item.price?.id ?? null),
        },
        '[BILLING] A subscription bills no plan of ours; the organization keeps the plan it had.',
      );
    }
    return null;
  }

  /** The subscription item that carries the plan: the one a plan change re-prices. */
  private async planItemOf(subscription: Stripe.Subscription): Promise<Stripe.SubscriptionItem | null> {
    for (const item of subscription.items?.data ?? []) {
      if (await this.saasService.planForPrice(item.price?.id)) return item;
    }
    return null;
  }

  /**
   * Current period end of a subscription, in either shape Stripe has used.
   *
   * `current_period_end` lived on the subscription root through the 2025-01 API and moved onto
   * each subscription item afterwards. Reading only the root returns `undefined` against a newer
   * API version, and `new Date(undefined * 1000)` is an Invalid Date that TypeORM happily writes
   * — so the renewal date silently became null and every downstream period calculation drifted.
   */
  private periodEndOf(subscription: Stripe.Subscription): Date | null {
    const root = (subscription as unknown as { current_period_end?: number }).current_period_end;
    if (typeof root === 'number') return new Date(root * 1000);

    const itemEnd = subscription.items?.data
      ?.map((item) => (item as unknown as { current_period_end?: number }).current_period_end)
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => b - a)[0];

    return typeof itemEnd === 'number' ? new Date(itemEnd * 1000) : null;
  }

  /** Stripe moved `subscription` off the invoice root in newer API versions; read both shapes. */
  private subscriptionIdOf(invoice: Stripe.Invoice): string | null {
    const direct = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
    if (typeof direct === 'string') return direct;
    if (direct?.id) return direct.id;

    const parentSubscription = (
      invoice as unknown as {
        parent?: { subscription_details?: { subscription?: string | { id: string } } };
      }
    ).parent?.subscription_details?.subscription;
    if (typeof parentSubscription === 'string') return parentSubscription;
    return parentSubscription?.id ?? null;
  }
}
