
import { Injectable, Inject, BadRequestException, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PaymentGateway, CreateCheckoutSessionDto, CheckoutSessionResult, WebhookResult } from '../interfaces/payment-gateway.interface';
import { STRIPE_CLIENT } from '../stripe/stripe.provider';
import { Repository, DataSource } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { SaasService } from '../../saas/saas.service';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { SAAS_CONFIG } from '../../saas/saas.config';

@Injectable()
export class StripePaymentAdapter implements PaymentGateway {
  private readonly logger = new Logger(StripePaymentAdapter.name);

  constructor(
    @Inject(STRIPE_CLIENT) private stripe: Stripe,
    @InjectRepository(Organization) private organizationRepository: Repository<Organization>,
    @InjectRepository(WebhookEvent) private webhookEventRepository: Repository<WebhookEvent>,
    private configService: ConfigService,
    private dataSource: DataSource,
    private saasService: SaasService
  ) {}

  async createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<CheckoutSessionResult> {
    const { organizationId, userEmail, priceId, successUrl, cancelUrl, metadata } = dto;

    const organization = await this.organizationRepository.findOne({ where: { id: organizationId } });
    if (!organization) {
      throw new BadRequestException('Organization not found');
    }

    let customerId = organization.externalCustomerId;

    if (!customerId) {
      const customer = await this.stripe.customers.create({
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

    const session = await this.stripe.checkout.sessions.create({
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

  async handleWebhook(payload: Buffer, signature: string): Promise<WebhookResult> {
      const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
      let event: Stripe.Event;

      try {
        event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
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
                const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
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
