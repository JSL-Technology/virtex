import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
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
import { Organization } from '../../organizations/entities/organization.entity';
import { SaasService } from '../../saas/saas.service';
import type { BillingPeriod } from '../../saas/enums/billing-period.enum';
import { PlanChangeReason, SubscriptionStanding } from '../../saas/plan-change';
import { BadRequestError, ServiceUnavailableError } from '../../i18n/localized.exception';
import { isDevLikeEnvironment } from '../../config/environment';
import { BillingStateService } from '../billing-state.service';
import { overviewFromRecord } from '../billing-overview';

/** What a simulated checkout session carries. Signed, so a client cannot mint or alter one. */
interface SimulatedSessionClaims {
  /** `registration` for signup, `organization` for a plan change of an existing tenant. */
  kind: 'registration' | 'organization';
  planSlug: string;
  email: string;
  pendingRegistrationId: string | null;
  organizationId: string | null;
  /** Who started an organization's plan change, for its history. */
  initiatedBy: string | null;
  /** Whether it changes a subscription in force or buys a new one: the history says which. */
  flow: PlanChangeStart['flow'] | null;
  trialPeriodDays: number | null;
  issuedAt: number;
  nonce: string;
}

const SESSION_PREFIX = 'sim_cs_';
/** A simulated session is only valid as long as a real Checkout session would plausibly be. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERIOD_DAYS = 30;

/**
 * A payment gateway that completes every checkout without charging anything.
 *
 * Development and test only: `resolvePaymentProvider` never selects it outside those
 * environments, `env.validation.ts` rejects `PAYMENT_PROVIDER=simulated` in a deployment, and the
 * adapter itself refuses to work if it is ever constructed elsewhere.
 *
 * It follows the same contract as `StripePaymentAdapter`, so the code under it — pending
 * registration, `register-confirm`, the transaction cookie that binds the checkout to one browser,
 * plan reconciliation, the billing screen — runs exactly as it does against Stripe. Sessions are
 * stateless HMAC-signed tokens: no table, nothing to clean up, and a session id cannot be forged or
 * re-pointed at another registration or organization.
 */
@Injectable()
export class SimulatedPaymentAdapter implements PaymentGateway, OnModuleInit {
  private readonly logger = new Logger(SimulatedPaymentAdapter.name);
  /** Per-process key. Sessions do not survive a restart, which is the right lifetime for a fake. */
  private readonly signingKey = randomBytes(32);

  constructor(
    @InjectRepository(Organization) private readonly organizationRepository: Repository<Organization>,
    private readonly saasService: SaasService,
    private readonly billingState: BillingStateService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    if (!isDevLikeEnvironment()) return;
    this.logger.warn(
      { event: 'payment_provider_simulated' },
      'Payment provider: simulated. Checkouts complete without charging. Set PAYMENT_PROVIDER=stripe and the STRIPE_* variables to use Stripe.',
    );
  }

  priceIdFor(plan: { slug: string }, period: BillingPeriod): string | null {
    return `sim_price_${plan.slug}_${period}`;
  }

  async createRegistrationCheckoutSession(dto: CreateRegistrationCheckoutDto): Promise<CheckoutSessionResult> {
    this.assertAllowed();
    const pendingRegistrationId =
      typeof dto.metadata?.['pendingRegistrationId'] === 'string' ? dto.metadata['pendingRegistrationId'] : null;
    if (!pendingRegistrationId) {
      throw new BadRequestError('auth.invalid_registration_session');
    }
    const sessionId = this.sign({
      kind: 'registration',
      planSlug: dto.planSlug,
      email: dto.email,
      pendingRegistrationId,
      organizationId: null,
      initiatedBy: null,
      flow: null,
      trialPeriodDays: dto.trialPeriodDays ?? null,
      issuedAt: Date.now(),
      nonce: randomUUID(),
    });
    return { sessionId, url: this.redirectUrl(dto.successUrl, sessionId) };
  }

  /**
   * The same two flows the real provider has, completed without charging: a subscription in force
   * has its plan changed, an organization without one is subscribed. Both come back through the
   * signed session, which `confirmOrganizationCheckout` records.
   */
  async startPlanChange(request: StartPlanChangeRequest): Promise<PlanChangeStart> {
    this.assertAllowed();
    const planSlug = this.planSlugOf(request.priceId);
    const organization = await this.organizationRepository.findOne({ where: { id: request.organizationId } });
    if (!organization) {
      throw new BadRequestError('payment.organization_not_found');
    }
    const flow: PlanChangeStart['flow'] =
      organization.subscriptionStatus && SubscriptionStanding.IN_FORCE.has(organization.subscriptionStatus)
        ? 'subscription_update'
        : 'checkout';
    const sessionId = this.sign({
      kind: 'organization',
      planSlug,
      email: request.userEmail,
      pendingRegistrationId: null,
      organizationId: request.organizationId,
      initiatedBy: request.actorUserId,
      flow,
      trialPeriodDays: null,
      issuedAt: Date.now(),
      nonce: randomUUID(),
    });
    return { flow, url: this.redirectUrl(request.successUrl, sessionId) };
  }

  async getCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo> {
    this.assertAllowed();
    const claims = this.verify(sessionId);
    const days = claims.trialPeriodDays && claims.trialPeriodDays > 0 ? claims.trialPeriodDays : DEFAULT_PERIOD_DAYS;
    return {
      status: 'complete',
      paymentStatus: claims.trialPeriodDays ? 'no_payment_required' : 'paid',
      customerId: this.customerIdFor(claims.email),
      subscriptionId: `sim_sub_${claims.pendingRegistrationId ?? claims.organizationId}`,
      subscriptionStatus: claims.trialPeriodDays ? 'trialing' : 'active',
      currentPeriodEnd: new Date(claims.issuedAt + days * 24 * 60 * 60 * 1000),
      pendingRegistrationId: claims.pendingRegistrationId,
      planSlug: claims.planSlug,
    };
  }

  async confirmOrganizationCheckout(organizationId: string, sessionId: string): Promise<BillingOverview> {
    this.assertAllowed();
    const claims = this.verify(sessionId);
    // Fail closed exactly like the Stripe adapter: a session minted for another tenant, or for a
    // signup, is never applied to this organization.
    if (claims.kind !== 'organization' || claims.organizationId !== organizationId) {
      throw new BadRequestError('payment.payment_session_does_not_belong_organization');
    }
    const session = await this.getCheckoutSession(sessionId);
    const plan = await this.saasService.getPlanBySlug(claims.planSlug);

    const stale = await this.dataSource.transaction(async (manager) => {
      const group = await this.billingState.billedWith(manager, organizationId);
      const anchor = group.find((organization) => organization.id === organizationId);
      if (!anchor) {
        throw new BadRequestError('payment.organization_not_found');
      }
      return this.billingState.record(
        manager,
        group,
        {
          // A plan change keeps the subscription it changes; only a new subscription has a new id.
          subscriptionId:
            (claims.flow === 'subscription_update' ? anchor.externalSubscriptionId : null) ??
            session.subscriptionId ??
            `sim_sub_${organizationId}`,
          customerId: session.customerId,
          status: session.subscriptionStatus ?? 'active',
          periodEnd: session.currentPeriodEnd,
          plan,
        },
        {
          reason: claims.flow === 'subscription_update' ? PlanChangeReason.PROVIDER_UPDATE : PlanChangeReason.CHECKOUT,
          changedBy: claims.initiatedBy,
        },
      );
    });
    for (const id of stale) await this.saasService.clearOrganizationCache(id);
    return this.getBillingOverview(organizationId);
  }

  /** There is no provider-side state behind a simulated subscription: what is recorded is all of it. */
  async reconcileSubscription(organizationId: string): Promise<BillingOverview> {
    return this.getBillingOverview(organizationId);
  }

  async getBillingOverview(organizationId: string): Promise<BillingOverview> {
    const organization = await this.organizationRepository.findOne({
      where: { id: organizationId },
      relations: ['plan'],
    });
    if (!organization) {
      throw new BadRequestError('payment.organization_not_found');
    }
    // There is no provider portal behind a simulated subscription.
    return overviewFromRecord(organization, 'platform');
  }

  async getInvoices(): Promise<BillingInvoice[]> {
    return [];
  }

  async createBillingPortalSession(): Promise<{ url: string }> {
    throw new BadRequestError('payment.no_active_subscription_manage');
  }

  async handleWebhook(): Promise<WebhookResult> {
    throw new ServiceUnavailableError('payment.webhooks_unavailable_simulated_provider');
  }

  async voidOrphanedSubscription(subscriptionId: string, reason: string): Promise<void> {
    this.logger.warn(
      { event: 'simulated_orphaned_subscription', subscriptionId, reason },
      'Simulated subscription discarded: its account could not be created.',
    );
  }

  // ── Internals ────────────────────────────────────────────────────────────────────────────────

  private assertAllowed(): void {
    if (!isDevLikeEnvironment()) {
      // Unreachable through configuration; kept so a wiring mistake fails loudly instead of
      // granting subscriptions for free.
      throw new ServiceUnavailableError('payment.simulated_provider_not_allowed');
    }
  }

  private redirectUrl(successUrl: string, sessionId: string): string {
    // Stripe expands the literal `{CHECKOUT_SESSION_ID}`; the simulated checkout does the same.
    if (successUrl.includes('{CHECKOUT_SESSION_ID}')) {
      return successUrl.replace('{CHECKOUT_SESSION_ID}', encodeURIComponent(sessionId));
    }
    const url = new URL(successUrl);
    url.searchParams.set('session_id', sessionId);
    return url.toString();
  }

  private planSlugOf(priceId: string): string {
    const match = /^sim_price_(.+)_(monthly|annual)$/.exec(priceId);
    if (!match) {
      throw new BadRequestError('payment.no_valid_plan_specified_price_id');
    }
    return match[1];
  }

  private customerIdFor(email: string): string {
    return `sim_cus_${createHmac('sha256', this.signingKey).update(email.toLowerCase()).digest('hex').slice(0, 16)}`;
  }

  private sign(claims: SimulatedSessionClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac('sha256', this.signingKey).update(payload).digest('base64url');
    return `${SESSION_PREFIX}${payload}.${signature}`;
  }

  private verify(sessionId: string): SimulatedSessionClaims {
    if (!sessionId?.startsWith(SESSION_PREFIX)) {
      throw new BadRequestError('auth.invalid_registration_session');
    }
    const [payload, signature] = sessionId.slice(SESSION_PREFIX.length).split('.');
    if (!payload || !signature) {
      throw new BadRequestError('auth.invalid_registration_session');
    }
    const expected = createHmac('sha256', this.signingKey).update(payload).digest();
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new BadRequestError('auth.invalid_registration_session');
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SimulatedSessionClaims;
    if (Date.now() - claims.issuedAt > SESSION_TTL_MS) {
      throw new BadRequestError('auth.invalid_registration_session');
    }
    return claims;
  }
}
