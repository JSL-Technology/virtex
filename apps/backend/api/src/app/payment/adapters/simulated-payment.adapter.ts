import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import {
  BillingInvoice,
  BillingOverview,
  CheckoutSessionInfo,
  CheckoutSessionResult,
  CreateCheckoutSessionDto,
  CreateRegistrationCheckoutDto,
  PaymentGateway,
  WebhookResult,
} from '../interfaces/payment-gateway.interface';
import { Organization } from '../../organizations/entities/organization.entity';
import { SaasService } from '../../saas/saas.service';
import { minorUnitFactor } from '../../saas/saas.config';
import type { BillingPeriod } from '../../saas/enums/billing-period.enum';
import { BadRequestError, ServiceUnavailableError } from '../../i18n/localized.exception';
import { isDevLikeEnvironment } from '../../config/environment';

/** What a simulated checkout session carries. Signed, so a client cannot mint or alter one. */
interface SimulatedSessionClaims {
  /** `registration` for signup, `organization` for a plan change of an existing tenant. */
  kind: 'registration' | 'organization';
  planSlug: string;
  email: string;
  pendingRegistrationId: string | null;
  organizationId: string | null;
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
      trialPeriodDays: dto.trialPeriodDays ?? null,
      issuedAt: Date.now(),
      nonce: randomUUID(),
    });
    return { sessionId, url: this.redirectUrl(dto.successUrl, sessionId) };
  }

  async createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<CheckoutSessionResult> {
    this.assertAllowed();
    const planSlug = this.planSlugOf(dto.priceId);
    const sessionId = this.sign({
      kind: 'organization',
      planSlug,
      email: dto.userEmail,
      pendingRegistrationId: null,
      organizationId: dto.organizationId,
      trialPeriodDays: null,
      issuedAt: Date.now(),
      nonce: randomUUID(),
    });
    return { sessionId, url: this.redirectUrl(dto.successUrl, sessionId) };
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
    const organization = await this.organizationRepository.findOne({ where: { id: organizationId } });
    if (!organization) {
      throw new BadRequestError('payment.organization_not_found');
    }
    const session = await this.getCheckoutSession(sessionId);
    organization.externalCustomerId = session.customerId;
    organization.externalSubscriptionId = session.subscriptionId;
    organization.subscriptionStatus = session.subscriptionStatus ?? 'active';
    organization.subscriptionPeriodEnd = session.currentPeriodEnd;
    const plan = await this.saasService.getPlanBySlug(claims.planSlug);
    if (plan) {
      organization.plan = plan;
      organization.planId = plan.id;
    }
    await this.organizationRepository.save(organization);
    await this.saasService.clearOrganizationCache(organizationId);
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
    const currency = SaasService.currencyForCountry(organization.country ?? undefined);
    return {
      plan: organization.plan
        ? {
            slug: organization.plan.slug,
            name: organization.plan.name,
            monthlyPrice:
              SaasService.priceFor(organization.plan.slug, currency) ?? organization.plan.monthlyPrice ?? null,
            currency,
            minorUnits: minorUnitFactor(currency),
          }
        : null,
      subscription: organization.subscriptionStatus
        ? {
            status: organization.subscriptionStatus,
            currentPeriodEnd: organization.subscriptionPeriodEnd
              ? new Date(organization.subscriptionPeriodEnd).toISOString()
              : null,
            cancelAtPeriodEnd: false,
            // There is no provider portal behind a simulated subscription.
            managedBy: 'platform',
          }
        : null,
      paymentMethod: null,
    };
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
