
import { Injectable, Inject, BadRequestException, ServiceUnavailableException, Logger, forwardRef, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PaymentGateway, CreateCheckoutSessionDto, CreateRegistrationCheckoutDto, CheckoutSessionInfo, CheckoutSessionResult, WebhookResult, BillingOverview, BillingInvoice } from '../interfaces/payment-gateway.interface';
import { STRIPE_CLIENT } from '../stripe/stripe.provider';
import { Repository, DataSource } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { SaasService } from '../../saas/saas.service';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { SAAS_CONFIG, SAAS_PLANS, minorUnitFactor } from '../../saas/saas.config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RegistrationPaymentCompletedEvent } from '../events/registration-payment-completed.event';

@Injectable()
export class StripePaymentAdapter implements PaymentGateway, OnModuleInit {
  private readonly logger = new Logger(StripePaymentAdapter.name);

  constructor(
    @Inject(STRIPE_CLIENT) private stripe: Stripe,
    @InjectRepository(Organization) private organizationRepository: Repository<Organization>,
    @InjectRepository(WebhookEvent) private webhookEventRepository: Repository<WebhookEvent>,
    private configService: ConfigService,
    private dataSource: DataSource,
    private saasService: SaasService,
    private eventEmitter: EventEmitter2
  ) {}

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
      const priceId = process.env[plan.monthlyPriceIdVar];
      if (!priceId) {
        problems.push(`${plan.slug}: ${plan.monthlyPriceIdVar} is not set`);
        continue;
      }

      let price: Stripe.Price;
      try {
        price = await this.stripe.prices.retrieve(priceId, { expand: ['currency_options'] });
      } catch (error) {
        problems.push(`${plan.slug}: price ${priceId} could not be read (${(error as Error).message})`);
        continue;
      }

      for (const [currency, expected] of Object.entries(plan.monthlyPrices)) {
        const code = currency.toLowerCase();
        const actual =
          code === price.currency
            ? price.unit_amount
            : price.currency_options?.[code]?.unit_amount ?? null;

        if (actual === null || actual === undefined) {
          problems.push(
            `${plan.slug}: we quote ${currency} but price ${priceId} has no amount for it`,
          );
          continue;
        }
        if (actual !== expected) {
          const factor = minorUnitFactor(currency);
          problems.push(
            `${plan.slug}/${currency}: we display ${expected / factor} but Stripe charges ${actual / factor}`,
          );
        }
      }
    }

    if (problems.length === 0) {
      this.logger.log({ event: 'price_catalog_verified' }, 'Plan prices match Stripe.');
      return;
    }

    const summary = `Plan prices disagree with Stripe:\n  - ${problems.join('\n  - ')}`;
    if (this.configService.get('NODE_ENV') === 'production') {
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
      throw new ServiceUnavailableException('El sistema de pagos no está configurado. Contacta al administrador.');
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
  private paymentMethodsFor(countryCode?: string): Stripe.Checkout.SessionCreateParams.PaymentMethodType[] | undefined {
    const byCountry: Record<string, Stripe.Checkout.SessionCreateParams.PaymentMethodType[]> = {
      BR: ['card', 'boleto'],
      MX: ['card', 'oxxo'],
      US: ['card', 'us_bank_account'],
    };
    return byCountry[(countryCode ?? '').toUpperCase()];
  }

  async createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<CheckoutSessionResult> {
    const { organizationId, userEmail, priceId, successUrl, cancelUrl, metadata } = dto;

    const stripe = this.ensureStripe();

    if (!priceId) {
      throw new BadRequestException('No se especificó un plan válido (priceId faltante).');
    }

    const organization = await this.organizationRepository.findOne({ where: { id: organizationId } });
    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    let customerId = organization.externalCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        name: organization.legalName,
        metadata: {
          organizationId: organization.id,
        },
      });
      customerId = customer.id;

      organization.externalCustomerId = customerId;
      await this.organizationRepository.save(organization);
    }

    const plans = await this.saasService.getPlans();
    const plan = plans.find(p => p.monthlyPriceId === priceId || p.annualPriceId === priceId);
    const planSlug = plan ? plan.slug : 'unknown';

    const methods = this.paymentMethodsFor(organization.country ?? undefined);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      ...(methods ? { payment_method_types: methods } : {}),
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: {
          organizationId: organization.id,
          planSlug: planSlug,
          ...metadata
        },
      },
      metadata: {
          organizationId: organization.id,
          planSlug: planSlug,
          ...metadata
      }
    });

    if (!session.url) {
        throw new BadRequestException('Failed to create Stripe session URL');
    }

    return { sessionId: session.id, url: session.url };
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
      throw new BadRequestException('No se especificó un plan válido (priceId faltante).');
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
      // Selling software to a Mexican or Colombian company obliges US to issue that company a
      // compliant invoice with its tax identifier on it — our own compliance, not the customer's.
      // None of this was configured, so the subscription was billed with no tax treatment at all
      // and the buyer's tax id was never recorded against the Stripe customer.
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      // Required by Stripe whenever automatic_tax is on: the address it derives the rate from has
      // to be allowed to change during checkout.
      billing_address_collection: 'required',
      subscription_data: {
        ...(dto.trialPeriodDays && dto.trialPeriodDays > 0
          ? { trial_period_days: dto.trialPeriodDays }
          : {}),
        metadata,
      },
      metadata,
    });

    if (!session.url) {
      throw new BadRequestException('Failed to create Stripe session URL');
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
      throw new BadRequestException('La sesión de pago no corresponde a esta organización.');
    }

    const settled = session.status === 'complete' &&
      (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');

    if (settled) {
      const organization = await this.organizationRepository.findOne({ where: { id: organizationId } });
      if (!organization) {
        throw new BadRequestException('Organization not found');
      }

      const subscription = (session.subscription && typeof session.subscription !== 'string')
        ? (session.subscription as Stripe.Subscription)
        : null;

      if (typeof session.customer === 'string') {
        organization.externalCustomerId = session.customer;
      }
      organization.externalSubscriptionId = subscription?.id ?? (typeof session.subscription === 'string' ? session.subscription : organization.externalSubscriptionId);
      organization.subscriptionStatus = subscription?.status ?? 'active';
      const periodEnd = subscription ? this.periodEndOf(subscription) : null;
      if (periodEnd) {
        organization.subscriptionPeriodEnd = periodEnd;
      }

      const planSlug = session.metadata?.planSlug;
      if (planSlug) {
        const plan = await this.saasService.getPlanBySlug(planSlug);
        if (plan) {
          organization.plan = plan;
          organization.planId = plan.id;
        }
      }

      await this.organizationRepository.save(organization);
      await this.saasService.clearOrganizationCache(organizationId);
    }

    return this.getBillingOverview(organizationId);
  }

  /**
   * Returns the organization's current plan (source of truth: our DB) plus the
   * live subscription + default payment method from Stripe. When Stripe is not
   * configured or the org has no customer/subscription yet, we still return the
   * DB plan so the UI can render the current state without a hard failure.
   */
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

  async getBillingOverview(organizationId: string): Promise<BillingOverview> {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
      relations: ['plan'],
    });
    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    // What this tenant is actually billed in, resolved exactly as the signup did — so the
    // amount on the billing screen is the amount on the invoice. The screen used to print
    // `$` + amount/100 for every tenant in every market.
    const currency = SaasService.currencyForCountry(organization.country ?? undefined);

    const overview: BillingOverview = {
      plan: organization.plan
        ? {
            slug: organization.plan.slug,
            name: organization.plan.name,
            monthlyPrice:
              SaasService.priceFor(organization.plan.slug, currency) ??
              organization.plan.monthlyPrice ??
              null,
            currency,
            minorUnits: minorUnitFactor(currency),
          }
        : null,
      subscription: null,
      paymentMethod: null,
    };

    // Without Stripe configured or a linked customer there is nothing live to fetch.
    if (!this.stripe || !organization.externalCustomerId) {
      return overview;
    }

    try {
      if (organization.externalSubscriptionId) {
        const sub = await this.stripe.subscriptions.retrieve(organization.externalSubscriptionId);
        const periodEnd = this.periodEndOf(sub);
        overview.subscription = {
          status: sub.status,
          currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        };
      }

      const customer = await this.stripe.customers.retrieve(organization.externalCustomerId, {
        expand: ['invoice_settings.default_payment_method'],
      });

      if (customer && !(customer as Stripe.DeletedCustomer).deleted) {
        const pm = (customer as Stripe.Customer).invoice_settings
          ?.default_payment_method as Stripe.PaymentMethod | null;
        if (pm?.card) {
          overview.paymentMethod = {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          };
        }
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
      throw new BadRequestException('Organization not found');
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
        description:
          inv.lines?.data?.[0]?.description ||
          (inv.number ? `Factura ${inv.number}` : 'Suscripción'),
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
      throw new BadRequestException('Organization not found');
    }
    if (!organization.externalCustomerId) {
      throw new BadRequestException('No existe una suscripción activa para gestionar.');
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
        throw new ServiceUnavailableException('Webhook de pagos no configurado.');
      }
      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      } catch (err) {
        this.logger.error(`Webhook signature verification failed: ${(err as Error).message}`);
        throw new BadRequestException('Webhook signature verification failed');
      }

      // Process safely inside a transaction
      await this.dataSource.transaction(async (manager) => {
          const existingEvent = await manager.findOne(WebhookEvent, { where: { id: event.id } });
          if (existingEvent) {
              this.logger.log(`Event ${event.id} already processed. Skipping.`);
              return;
          }

          this.logger.log(`Received Stripe event: ${event.type}`);

          try {
              switch (event.type) {
                  case 'checkout.session.completed':
                      await this.handleCheckoutSessionCompleted(
                          event.data.object as Stripe.Checkout.Session,
                          manager,
                      );
                      break;

                  case 'customer.subscription.created':
                  case 'customer.subscription.updated':
                  case 'customer.subscription.deleted':
                      await this.handleSubscriptionUpdated(
                          event.data.object as Stripe.Subscription,
                          manager,
                      );
                      break;

                  // Dunning. Without these the product could not tell a paying customer from one
                  // whose card has been failing for a fortnight: the subscription row only moved
                  // when Stripe eventually changed the subscription's own status, which happens
                  // after the whole retry schedule has run out.
                  case 'invoice.payment_failed':
                      await this.handleInvoicePaymentFailed(
                          event.data.object as Stripe.Invoice,
                          manager,
                      );
                      break;

                  case 'invoice.paid':
                      await this.handleInvoicePaid(event.data.object as Stripe.Invoice, manager);
                      break;

                  default:
                      this.logger.log(`Unhandled event type: ${event.type}`);
              }

              // Save processed event
              await manager.save(WebhookEvent, { id: event.id });

          } catch (error) {
              this.logger.error(`Error processing event ${event.id}: ${(error as Error).message}`);
              throw error;
          }
      });

      return { processed: true, eventId: event.id, type: event.type };
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session, manager: any) {
    const subscriptionId = session.subscription as string;
    const customerId = session.customer as string;
    const metadata = session.metadata || {};
    const planSlug = metadata.planSlug;

    // Payment-first signup: no org exists yet. Hand off to the auth side to
    // materialize the account from the pending registration. Idempotent there.
    if (metadata.pendingRegistrationId) {
      let currentPeriodEnd: Date | null = null;
      let subscriptionStatus = 'active';
      try {
        const sub = await this.ensureStripe().subscriptions.retrieve(subscriptionId);
        subscriptionStatus = sub.status;
        currentPeriodEnd = this.periodEndOf(sub);
      } catch (e) {
        this.logger.warn(`Could not retrieve subscription ${subscriptionId} during signup: ${(e as Error).message}`);
      }

      await this.eventEmitter.emitAsync(
        'registration.payment_completed',
        new RegistrationPaymentCompletedEvent(metadata.pendingRegistrationId, {
          customerId,
          subscriptionId,
          status: subscriptionStatus,
          currentPeriodEnd,
        })
      );
      return;
    }

    const organization = await manager.findOne(Organization, { where: { externalCustomerId: customerId } });

    if (organization) {
        organization.externalSubscriptionId = subscriptionId;
        organization.subscriptionStatus = 'active';

        if (planSlug) {
            const plan = await this.saasService.getPlanBySlug(planSlug);
            if (plan) {
                organization.plan = plan;
            } else {
                this.logger.warn(`Plan slug ${planSlug} from metadata not found.`);
            }
        } else {
             try {
                // We need to use this.stripe here. Adapter Pattern allows using specific SDK.
                const sub = await this.ensureStripe().subscriptions.retrieve(subscriptionId);
                const priceId = sub.items.data[0]?.price.id;
                if (priceId) {
                    const plans = await this.saasService.getPlans();
                    const matchedPlan = plans.find(p => p.monthlyPriceId === priceId || p.annualPriceId === priceId);
                    if (matchedPlan) {
                        organization.plan = matchedPlan;
                    }
                }
            } catch (e) {
                this.logger.error(`Failed to sync plan for org ${organization.id}: ${(e as Error).message}`);
            }
        }

        await manager.save(organization);
        this.logger.log(`Updated organization ${organization.id} with subscription ${subscriptionId}`);
    } else {
        this.logger.error(`Organization not found for customer ${customerId}`);
    }
  }

  /**
   * A renewal charge failed. Stripe will keep retrying on its own schedule, so access is not cut
   * off here — the organization enters a bounded grace period and the rest of the product decides
   * what to restrict. Recording it on the first failure (rather than waiting for the subscription
   * status to change at the end of the retry cycle) is what makes a dunning email possible.
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice, manager: any) {
    const subscriptionId = this.subscriptionIdOf(invoice);
    if (!subscriptionId) return;

    const organization = await manager.findOne(Organization, {
      where: { externalSubscriptionId: subscriptionId },
    });
    if (!organization) {
      this.logger.warn(`invoice.payment_failed for unknown subscription ${subscriptionId}`);
      return;
    }

    // Only extend the grace period; never shorten one already running, or a second failed retry
    // would silently hand the customer a fresh window.
    const graceEnd = new Date();
    graceEnd.setDate(graceEnd.getDate() + SAAS_CONFIG.GRACE_PERIOD_DAYS);
    if (!organization.gracePeriodEnd || organization.gracePeriodEnd < graceEnd) {
      organization.gracePeriodEnd = graceEnd;
    }
    organization.subscriptionStatus = 'past_due';
    await manager.save(organization);

    this.eventEmitter.emit('billing.payment_failed', {
      organizationId: organization.id,
      invoiceId: invoice.id,
      amountDue: invoice.amount_due,
      currency: invoice.currency,
      attemptCount: invoice.attempt_count ?? 0,
      nextAttempt: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000)
        : null,
      gracePeriodEnd: organization.gracePeriodEnd,
    });

    this.logger.warn(
      `Payment failed for organization ${organization.id}; grace period until ${organization.gracePeriodEnd?.toISOString()}.`,
    );
  }

  /**
   * A renewal succeeded. Clears the grace period so a customer who recovers is not left in a
   * degraded state until the next subscription-level event happens to arrive.
   */
  private async handleInvoicePaid(invoice: Stripe.Invoice, manager: any) {
    const subscriptionId = this.subscriptionIdOf(invoice);
    if (!subscriptionId) return;

    const organization = await manager.findOne(Organization, {
      where: { externalSubscriptionId: subscriptionId },
    });
    if (!organization) return;

    organization.subscriptionStatus = 'active';
    organization.gracePeriodEnd = null;
    await manager.save(organization);
    await this.saasService.clearOrganizationCache(organization.id);

    this.eventEmitter.emit('billing.payment_succeeded', {
      organizationId: organization.id,
      invoiceId: invoice.id,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
    });
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

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription, manager: any) {
    const organization = await manager.findOne(Organization, { where: { externalSubscriptionId: subscription.id } });

    if (organization) {
        organization.subscriptionStatus = subscription.status;
        const periodEnd = this.periodEndOf(subscription);
        if (periodEnd) {
          organization.subscriptionPeriodEnd = periodEnd;
        }

        if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
             const graceEnd = new Date();
             graceEnd.setDate(graceEnd.getDate() + SAAS_CONFIG.GRACE_PERIOD_DAYS);
             organization.gracePeriodEnd = graceEnd;

             this.logger.warn(`Organization ${organization.id} subscription is ${subscription.status}. Grace period set until ${graceEnd.toISOString()}.`);
        } else if (subscription.status === 'active') {
             organization.gracePeriodEnd = null;
        }

        await manager.save(organization);
        this.logger.log(`Updated organization ${organization.id} subscription status to ${subscription.status}`);
    }
  }
}
