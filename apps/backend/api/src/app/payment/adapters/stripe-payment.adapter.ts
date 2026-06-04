
import { Injectable, Inject, BadRequestException, ServiceUnavailableException, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PaymentGateway, CreateCheckoutSessionDto, CreateRegistrationCheckoutDto, CheckoutSessionInfo, CheckoutSessionResult, WebhookResult, BillingOverview, BillingInvoice } from '../interfaces/payment-gateway.interface';
import { STRIPE_CLIENT } from '../stripe/stripe.provider';
import { Repository, DataSource } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { SaasService } from '../../saas/saas.service';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { SAAS_CONFIG } from '../../saas/saas.config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RegistrationPaymentCompletedEvent } from '../events/registration-payment-completed.event';

@Injectable()
export class StripePaymentAdapter implements PaymentGateway {
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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: dto.email,
      allow_promotion_codes: true,
      line_items: [{ price: dto.priceId, quantity: 1 }],
      success_url: dto.successUrl,
      cancel_url: dto.cancelUrl,
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
      currentPeriodEnd: subscription && (subscription as any).current_period_end
        ? new Date((subscription as any).current_period_end * 1000)
        : null,
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

    // Security: only reconcile sessions that were created for this org.
    if (session.metadata?.organizationId && session.metadata.organizationId !== organizationId) {
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
      if (subscription && (subscription as any).current_period_end) {
        organization.subscriptionPeriodEnd = new Date((subscription as any).current_period_end * 1000);
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
  async getBillingOverview(organizationId: string): Promise<BillingOverview> {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
      relations: ['plan'],
    });
    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    const overview: BillingOverview = {
      plan: organization.plan
        ? {
            slug: organization.plan.slug,
            name: organization.plan.name,
            monthlyPrice: organization.plan.monthlyPrice ?? null,
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
        const periodEnd = (sub as any).current_period_end;
        overview.subscription = {
          status: sub.status,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
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
      this.logger.warn(`Failed to fetch live billing data for org ${organizationId}: ${e.message}`);
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
      this.logger.warn(`Failed to fetch invoices for org ${organizationId}: ${e.message}`);
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
        this.logger.error(`Webhook signature verification failed: ${err.message}`);
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
                      const session = event.data.object as Stripe.Checkout.Session;
                      await this.handleCheckoutSessionCompleted(session, manager);
                      break;
                  case 'customer.subscription.deleted':
                  case 'customer.subscription.updated':
                      const subscription = event.data.object as Stripe.Subscription;
                      await this.handleSubscriptionUpdated(subscription, manager);
                      break;
                  default:
                      this.logger.log(`Unhandled event type: ${event.type}`);
              }

              // Save processed event
              await manager.save(WebhookEvent, { id: event.id });

          } catch (error) {
              this.logger.error(`Error processing event ${event.id}: ${error.message}`);
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
        if ((sub as any).current_period_end) {
          currentPeriodEnd = new Date((sub as any).current_period_end * 1000);
        }
      } catch (e) {
        this.logger.warn(`Could not retrieve subscription ${subscriptionId} during signup: ${e.message}`);
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
                this.logger.error(`Failed to sync plan for org ${organization.id}: ${e.message}`);
            }
        }

        await manager.save(organization);
        this.logger.log(`Updated organization ${organization.id} with subscription ${subscriptionId}`);
    } else {
        this.logger.error(`Organization not found for customer ${customerId}`);
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription, manager: any) {
    const organization = await manager.findOne(Organization, { where: { externalSubscriptionId: subscription.id } });

    if (organization) {
        organization.subscriptionStatus = subscription.status;
        organization.subscriptionPeriodEnd = new Date((subscription as any).current_period_end * 1000);

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
