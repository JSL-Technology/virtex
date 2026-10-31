import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
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
import { SAAS_PLANS, minorUnitFactor } from '../../saas/saas.config';
import { BILLING_PERIODS, type BillingPeriod } from '../../saas/enums/billing-period.enum';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../../i18n/localized.exception';
import { BillingIntentKind, BillingIntentStatus, BillingPaymentIntent } from '../entities/billing-payment-intent.entity';
import { RegistrationPaymentCompletedEvent } from '../events/registration-payment-completed.event';
import {
  AzulSettings,
  PaymentPageRequest,
  azulAmount,
  azulSettings,
  callWebService,
  paymentPageForm,
  responseHashValid,
  tokenSalePayload,
} from '../azul/azul';

/** The currency Azul charges in. Its Payment Page settles Dominican pesos (`$`). */
const AZUL_CURRENCY = 'DOP';
/** A checkout left unpaid this long is no longer payable. */
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const SUBSCRIPTION_PREFIX = 'azul_sub_';
const PRICE_PREFIX = 'azul_price_';

/**
 * Subscriptions charged through Azul, the Dominican acquirer — for a company that cannot bill
 * through Stripe (Stripe does not open merchant accounts to Dominican companies) and customers who
 * pay in pesos with local cards.
 *
 * The first charge goes through Azul's hosted Payment Page: the card never touches this server,
 * and Azul keeps it as a DataVault token. Renewals charge that token from
 * {@link AzulRenewalService}. The subscription is the platform's own record — `organizations`'
 * subscription fields plus one `billing_payment_intents` row per charge — so the billing screen,
 * the renewal and the platform's own e-CF for each charge all read the same rows.
 *
 * Prices are the plans' DOP amounts (`SAAS_PRICE_<PLAN>_DOP`), before ITBIS; the ITBIS rate
 * (`AZUL_ITBIS_RATE`, 18 % by default) is added on top and sent to Azul as such.
 */
@Injectable()
export class AzulPaymentAdapter implements PaymentGateway, OnModuleInit {
  private readonly logger = new Logger(AzulPaymentAdapter.name);
  private readonly settings: AzulSettings | null;
  private readonly itbisRate: number;

  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(BillingPaymentIntent) private readonly intents: Repository<BillingPaymentIntent>,
    private readonly saasService: SaasService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.settings = azulSettings(config);
    const rate = Number(config.get<string>('AZUL_ITBIS_RATE') ?? '0.18');
    this.itbisRate = Number.isFinite(rate) && rate >= 0 && rate < 1 ? rate : 0.18;
  }

  onModuleInit(): void {
    if (!this.settings) return;
    // Every plan must have a DOP amount, or a customer would be quoted one thing and charged
    // another — the same property the Stripe adapter checks against its Prices at boot.
    const unpriced = SAAS_PLANS.filter((plan) => typeof plan.monthlyPrices[AZUL_CURRENCY] !== 'number');
    if (unpriced.length) {
      this.logger.error(
        { event: 'azul_plans_unpriced', plans: unpriced.map((p) => p.slug) },
        'Plans without a DOP price cannot be sold through Azul. Set SAAS_PRICE_<PLAN>_DOP.',
      );
    }
  }

  // ── Prices ─────────────────────────────────────────────────────────────────

  priceIdFor(plan: { slug: string }, period: BillingPeriod): string | null {
    return this.amountFor(plan.slug, period) === null ? null : `${PRICE_PREFIX}${plan.slug}_${period}`;
  }

  /** The plan's DOP price for the period, before ITBIS, in centavos; null when it has none. */
  amountFor(planSlug: string, period: BillingPeriod): number | null {
    const plan = SAAS_PLANS.find((p) => p.slug === planSlug);
    const amount = period === 'annual' ? plan?.annualPrices[AZUL_CURRENCY] : plan?.monthlyPrices[AZUL_CURRENCY];
    return typeof amount === 'number' && amount > 0 ? amount : null;
  }

  /** Total and ITBIS for a charge, in centavos. */
  charge(planSlug: string, period: BillingPeriod): { amountMinor: number; taxMinor: number } {
    const base = this.amountFor(planSlug, period);
    if (base === null) throw new BadRequestError('payment.plan_not_available_local_currency', { plan: planSlug });
    const taxMinor = Math.round(base * this.itbisRate);
    return { amountMinor: base + taxMinor, taxMinor };
  }

  // ── Checkout ───────────────────────────────────────────────────────────────

  async createRegistrationCheckoutSession(dto: CreateRegistrationCheckoutDto): Promise<CheckoutSessionResult> {
    const settings = this.requireSettings();
    const pendingRegistrationId =
      typeof dto.metadata?.['pendingRegistrationId'] === 'string' ? (dto.metadata['pendingRegistrationId'] as string) : null;
    if (!pendingRegistrationId) throw new BadRequestError('auth.invalid_registration_session');
    const period = this.periodOf(dto.priceId);

    // A trial charges nothing now: the account is created at once, and the first charge is asked
    // for from the billing screen before the trial ends.
    if (dto.trialPeriodDays && dto.trialPeriodDays > 0) {
      const intent = await this.intents.save(
        this.intents.create({
          provider: 'azul',
          kind: 'registration',
          orderNumber: AzulPaymentAdapter.orderNumber(),
          pendingRegistrationId,
          email: dto.email,
          planSlug: dto.planSlug,
          billingPeriod: period,
          currency: AZUL_CURRENCY,
          amountMinor: 0,
          taxMinor: 0,
          status: BillingIntentStatus.APPROVED,
          periodEnd: new Date(Date.now() + dto.trialPeriodDays * 24 * 3600_000),
          invoicedAt: new Date(),
        }),
      );
      return { sessionId: intent.id, url: AzulPaymentAdapter.withSession(dto.successUrl, intent.id) };
    }

    const { amountMinor, taxMinor } = this.charge(dto.planSlug, period);
    const intent = await this.intents.save(
      this.intents.create({
        provider: 'azul',
        kind: 'registration',
        orderNumber: AzulPaymentAdapter.orderNumber(),
        pendingRegistrationId,
        email: dto.email,
        planSlug: dto.planSlug,
        billingPeriod: period,
        currency: AZUL_CURRENCY,
        amountMinor,
        taxMinor,
        status: BillingIntentStatus.PENDING,
        successUrl: dto.successUrl,
        cancelUrl: dto.cancelUrl,
      }),
    );
    return { sessionId: intent.id, url: `${settings.publicApiUrl}/payment/azul/pay/${intent.id}` };
  }

  async createCheckoutSession(dto: CreateCheckoutSessionDto): Promise<CheckoutSessionResult> {
    const settings = this.requireSettings();
    const { planSlug, period } = this.parsePrice(dto.priceId);
    const { amountMinor, taxMinor } = this.charge(planSlug, period);
    const intent = await this.intents.save(
      this.intents.create({
        provider: 'azul',
        kind: 'organization',
        orderNumber: AzulPaymentAdapter.orderNumber(),
        organizationId: dto.organizationId,
        email: dto.userEmail,
        planSlug,
        billingPeriod: period,
        currency: AZUL_CURRENCY,
        amountMinor,
        taxMinor,
        status: BillingIntentStatus.PENDING,
        successUrl: dto.successUrl,
        cancelUrl: dto.cancelUrl,
      }),
    );
    return { sessionId: intent.id, url: `${settings.publicApiUrl}/payment/azul/pay/${intent.id}` };
  }

  /** The auto-submitting form that takes the buyer to Azul's Payment Page. */
  async paymentPage(intentId: string): Promise<string> {
    const settings = this.requireSettings();
    const intent = await this.requireIntent(intentId);
    if (intent.status !== BillingIntentStatus.PENDING || Date.now() - intent.createdAt.getTime() > INTENT_TTL_MS) {
      throw new BadRequestError('payment.checkout_no_longer_payable');
    }
    const back = (outcome: string) => `${settings.publicApiUrl}/payment/azul/return/${intent.id}/${outcome}`;
    const fields: PaymentPageRequest = {
      MerchantId: settings.merchantId,
      MerchantName: settings.merchantName,
      MerchantType: settings.merchantType,
      CurrencyCode: '$',
      OrderNumber: intent.orderNumber,
      Amount: azulAmount(intent.amountMinor),
      ITBIS: azulAmount(intent.taxMinor),
      ApprovedUrl: back('approved'),
      DeclinedUrl: back('declined'),
      CancelUrl: back('cancelled'),
      UseCustomField1: '1',
      CustomField1Label: 'Plan',
      CustomField1Value: intent.planSlug,
      UseCustomField2: '0',
      CustomField2Label: '',
      CustomField2Value: '',
    };
    // The card is kept by Azul (DataVault) so renewals can charge it without the buyer present.
    return paymentPageForm(settings, fields, { SaveToDataVault: '1', ShowTransactionResult: '0', Locale: 'ES' });
  }

  /**
   * Azul sent the buyer back. The query is trusted only if its `AuthHash` verifies and it names this
   * intent's order and amount; then the intent records the outcome, a paid signup is materialised
   * (as Stripe's webhook does) and the buyer continues to the product.
   */
  async completeReturn(
    intentId: string,
    outcome: 'approved' | 'declined' | 'cancelled',
    query: Record<string, string | undefined>,
  ): Promise<string> {
    const settings = this.requireSettings();
    const intent = await this.requireIntent(intentId);
    const cancelUrl = intent.cancelUrl ?? intent.successUrl ?? settings.publicApiUrl;
    if (outcome === 'cancelled') {
      if (intent.status === BillingIntentStatus.PENDING) {
        intent.status = BillingIntentStatus.CANCELLED;
        await this.intents.save(intent);
      }
      return cancelUrl;
    }
    if (!responseHashValid(query, settings.authKey)) {
      this.logger.warn({ event: 'azul_return_hash_invalid', intentId }, 'Azul return with an invalid AuthHash');
      throw new BadRequestError('payment.azul_response_not_authentic');
    }
    if (query['OrderNumber'] !== intent.orderNumber || query['Amount'] !== azulAmount(intent.amountMinor)) {
      throw new BadRequestError('payment.azul_response_not_authentic');
    }
    if (intent.status === BillingIntentStatus.APPROVED) {
      return AzulPaymentAdapter.withSession(intent.successUrl ?? settings.publicApiUrl, intent.id);
    }

    const approved = outcome === 'approved' && query['IsoCode'] === '00';
    intent.status = approved ? BillingIntentStatus.APPROVED : BillingIntentStatus.DECLINED;
    intent.authorizationCode = query['AuthorizationCode'] ?? null;
    intent.providerOrderId = query['AzulOrderId'] ?? null;
    intent.rrn = query['RRN'] ?? null;
    intent.cardToken = query['DataVaultToken'] || null;
    intent.cardBrand = query['DataVaultBrand'] ?? null;
    intent.cardLast4 = (query['CardNumber'] ?? '').replace(/\D/g, '').slice(-4) || null;
    intent.response = AzulPaymentAdapter.safeResponse(query);
    if (approved) intent.periodEnd = AzulPaymentAdapter.periodEnd(new Date(), intent.billingPeriod as BillingPeriod);
    await this.intents.save(intent);

    if (!approved) return cancelUrl;

    if (intent.kind === 'registration' && intent.pendingRegistrationId) {
      await this.events.emitAsync(
        'registration.payment_completed',
        new RegistrationPaymentCompletedEvent(intent.pendingRegistrationId, {
          customerId: this.customerId(intent),
          subscriptionId: `${SUBSCRIPTION_PREFIX}${intent.id}`,
          status: 'active',
          currentPeriodEnd: intent.periodEnd,
        }),
      ).catch((error) =>
        // The confirm call from the browser materialises it too; this is the second path.
        this.logger.error(`Account materialisation after Azul payment failed: ${(error as Error).message}`),
      );
    }
    return AzulPaymentAdapter.withSession(intent.successUrl ?? settings.publicApiUrl, intent.id);
  }

  async getCheckoutSession(sessionId: string): Promise<CheckoutSessionInfo> {
    const intent = await this.requireIntent(sessionId);
    const paid = intent.status === BillingIntentStatus.APPROVED;
    const trial = paid && intent.amountMinor === 0;
    return {
      status: paid ? 'complete' : intent.status === BillingIntentStatus.PENDING ? 'open' : 'expired',
      paymentStatus: trial ? 'no_payment_required' : paid ? 'paid' : 'unpaid',
      customerId: this.customerId(intent),
      subscriptionId: paid ? `${SUBSCRIPTION_PREFIX}${intent.id}` : null,
      subscriptionStatus: trial ? 'trialing' : paid ? 'active' : null,
      currentPeriodEnd: intent.periodEnd,
      pendingRegistrationId: intent.pendingRegistrationId,
      planSlug: intent.planSlug,
    };
  }

  async confirmOrganizationCheckout(organizationId: string, sessionId: string): Promise<BillingOverview> {
    const intent = await this.requireIntent(sessionId);
    if (intent.kind !== 'organization' || intent.organizationId !== organizationId) {
      throw new BadRequestError('payment.payment_session_does_not_belong_organization');
    }
    if (intent.status !== BillingIntentStatus.APPROVED) throw new BadRequestError('payment.checkout_not_paid');
    const organization = await this.organizations.findOne({ where: { id: organizationId } });
    if (!organization) throw new BadRequestError('payment.organization_not_found');
    organization.externalCustomerId = this.customerId(intent);
    organization.externalSubscriptionId = `${SUBSCRIPTION_PREFIX}${intent.id}`;
    organization.subscriptionStatus = 'active';
    organization.subscriptionPeriodEnd = intent.periodEnd;
    const plan = await this.saasService.getPlanBySlug(intent.planSlug);
    if (plan) {
      organization.plan = plan;
      organization.planId = plan.id;
    }
    await this.organizations.save(organization);
    await this.saasService.clearOrganizationCache(organizationId);
    return this.getBillingOverview(organizationId);
  }

  // ── Billing screen ─────────────────────────────────────────────────────────

  async getBillingOverview(organizationId: string): Promise<BillingOverview> {
    const organization = await this.organizations.findOne({ where: { id: organizationId }, relations: ['plan'] });
    if (!organization) throw new BadRequestError('payment.organization_not_found');
    const card = await this.latestCard(organization);
    return {
      plan: organization.plan
        ? {
            slug: organization.plan.slug,
            name: organization.plan.name,
            monthlyPrice: this.amountFor(organization.plan.slug, 'monthly'),
            currency: AZUL_CURRENCY,
            minorUnits: minorUnitFactor(AZUL_CURRENCY),
          }
        : null,
      subscription: organization.subscriptionStatus
        ? {
            status: organization.subscriptionStatus,
            currentPeriodEnd: organization.subscriptionPeriodEnd
              ? new Date(organization.subscriptionPeriodEnd).toISOString()
              : null,
            cancelAtPeriodEnd: false,
            managedBy: 'platform',
          }
        : null,
      paymentMethod: card ? { brand: card.cardBrand ?? 'card', last4: card.cardLast4 ?? '', expMonth: 0, expYear: 0 } : null,
    };
  }

  async getInvoices(organizationId: string, limit = 24): Promise<BillingInvoice[]> {
    const organization = await this.organizations.findOne({ where: { id: organizationId } });
    if (!organization) return [];
    const charges = await this.chargesOf(organization, limit);
    return charges
      .filter((c) => c.amountMinor > 0 && c.status !== BillingIntentStatus.PENDING)
      .map((c) => ({
        id: c.id,
        number: c.orderNumber,
        date: c.createdAt.toISOString(),
        description: `${c.planSlug} (${c.billingPeriod})`,
        amount: c.amountMinor,
        currency: c.currency,
        status: c.status === BillingIntentStatus.APPROVED ? 'paid' : c.status.toLowerCase(),
        pdfUrl: null,
        hostedUrl: null,
      }));
  }

  async createBillingPortalSession(): Promise<{ url: string }> {
    // There is no acquirer portal: the card is changed by paying the next period through the
    // Payment Page, which the billing screen offers as a plan checkout.
    throw new BadRequestError('payment.no_portal_local_acquirer');
  }

  async handleWebhook(): Promise<WebhookResult> {
    throw new ServiceUnavailableError('payment.webhooks_unavailable_local_acquirer');
  }

  /** Void the charge behind a signup whose account could not be created. */
  async voidOrphanedSubscription(subscriptionId: string, reason: string): Promise<void> {
    if (!subscriptionId?.startsWith(SUBSCRIPTION_PREFIX)) return;
    const intent = await this.intents.findOne({ where: { id: subscriptionId.slice(SUBSCRIPTION_PREFIX.length) } });
    if (!intent || intent.status !== BillingIntentStatus.APPROVED || intent.amountMinor === 0) return;
    const settings = this.requireSettings();
    const answer = await callWebService(
      settings,
      { Channel: 'EC', Store: settings.merchantId, AzulOrderId: intent.providerOrderId ?? '' },
      'ProcessVoid',
    );
    if (answer.IsoCode === '00') {
      intent.status = BillingIntentStatus.VOIDED;
      intent.response = { ...(intent.response ?? {}), void: AzulPaymentAdapter.safeResponse(answer as Record<string, unknown>), voidReason: reason };
      await this.intents.save(intent);
      return;
    }
    this.logger.error(
      { event: 'azul_void_failed', intentId: intent.id, iso: answer.IsoCode, message: answer.ResponseMessage },
      'An orphaned Azul charge could not be voided: refund it from the Azul portal.',
    );
    throw new ServiceUnavailableError('payment.azul_void_failed');
  }

  // ── For the renewal and the platform's own invoicing ───────────────────────

  /** Every charge of an organization, newest first: its own, and its signup's. */
  async chargesOf(organization: Organization, limit = 50): Promise<BillingPaymentIntent[]> {
    const firstId = organization.externalSubscriptionId?.startsWith(SUBSCRIPTION_PREFIX)
      ? organization.externalSubscriptionId.slice(SUBSCRIPTION_PREFIX.length)
      : null;
    const own = await this.intents.find({
      where: { organizationId: organization.id, provider: 'azul' },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    const first = firstId ? await this.intents.findOne({ where: { id: firstId } }) : null;
    return [...own, ...(first && !own.some((i) => i.id === first.id) ? [first] : [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /** The last charge that left a card token behind. */
  async latestCard(organization: Organization): Promise<BillingPaymentIntent | null> {
    const charges = await this.chargesOf(organization);
    return charges.find((c) => c.status === BillingIntentStatus.APPROVED && c.cardToken) ?? null;
  }

  /** Charge a renewal against the card on file. */
  async renew(organization: Organization, planSlug: string, period: BillingPeriod): Promise<BillingPaymentIntent> {
    const settings = this.requireSettings();
    const card = await this.latestCard(organization);
    const { amountMinor, taxMinor } = this.charge(planSlug, period);
    const intent = await this.intents.save(
      this.intents.create({
        provider: 'azul',
        kind: 'renewal' as BillingIntentKind,
        orderNumber: AzulPaymentAdapter.orderNumber(),
        organizationId: organization.id,
        planSlug,
        billingPeriod: period,
        currency: AZUL_CURRENCY,
        amountMinor,
        taxMinor,
        status: BillingIntentStatus.PENDING,
      }),
    );
    if (!card?.cardToken) {
      intent.status = BillingIntentStatus.DECLINED;
      intent.response = { reason: 'no_card_on_file' };
      return this.intents.save(intent);
    }
    try {
      const answer = await callWebService(
        settings,
        tokenSalePayload(settings, { orderNumber: intent.orderNumber, amountMinor, taxMinor, token: card.cardToken }),
      );
      const approved = answer.IsoCode === '00';
      intent.status = approved ? BillingIntentStatus.APPROVED : BillingIntentStatus.DECLINED;
      intent.authorizationCode = answer.AuthorizationCode ?? null;
      intent.providerOrderId = answer.AzulOrderId ?? null;
      intent.rrn = answer.RRN ?? null;
      intent.cardToken = card.cardToken;
      intent.cardBrand = card.cardBrand;
      intent.cardLast4 = card.cardLast4;
      intent.response = AzulPaymentAdapter.safeResponse(answer as Record<string, unknown>);
      if (approved) {
        const from = organization.subscriptionPeriodEnd && new Date(organization.subscriptionPeriodEnd) > new Date()
          ? new Date(organization.subscriptionPeriodEnd)
          : new Date();
        intent.periodEnd = AzulPaymentAdapter.periodEnd(from, period);
      }
    } catch (error) {
      // Nothing was charged, or we cannot tell: left PENDING is wrong, DECLINED retries tomorrow.
      intent.status = BillingIntentStatus.DECLINED;
      intent.response = { error: (error as Error).message };
    }
    return this.intents.save(intent);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private requireSettings(): AzulSettings {
    if (!this.settings) throw new ServiceUnavailableError('payment.azul_not_configured');
    return this.settings;
  }

  private async requireIntent(id: string): Promise<BillingPaymentIntent> {
    if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new BadRequestError('auth.invalid_registration_session');
    const intent = await this.intents.findOne({ where: { id, provider: 'azul' } });
    if (!intent) throw new NotFoundError('auth.invalid_registration_session');
    return intent;
  }

  private periodOf(priceId: string): BillingPeriod {
    return this.parsePrice(priceId).period;
  }

  private parsePrice(priceId: string): { planSlug: string; period: BillingPeriod } {
    const match = new RegExp(`^${PRICE_PREFIX}(.+)_(${BILLING_PERIODS.join('|')})$`).exec(priceId ?? '');
    if (!match) throw new BadRequestError('payment.no_valid_plan_specified_price_id');
    return { planSlug: match[1], period: match[2] as BillingPeriod };
  }

  private customerId(intent: BillingPaymentIntent): string {
    const who = intent.organizationId ?? intent.email ?? intent.id;
    return `azul_cus_${createHash('sha256').update(who.toLowerCase()).digest('hex').slice(0, 16)}`;
  }

  /** 15 characters, unique enough for Azul's `OrderNumber`: `VX` + time + randomness. */
  static orderNumber(): string {
    return `VX${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`.slice(0, 15);
  }

  static periodEnd(from: Date, period: BillingPeriod): Date {
    const end = new Date(from);
    if (period === 'annual') end.setFullYear(end.getFullYear() + 1);
    else end.setMonth(end.getMonth() + 1);
    return end;
  }

  static withSession(successUrl: string, sessionId: string): string {
    if (successUrl.includes('{CHECKOUT_SESSION_ID}')) {
      return successUrl.replace('{CHECKOUT_SESSION_ID}', encodeURIComponent(sessionId));
    }
    const url = new URL(successUrl);
    url.searchParams.set('session_id', sessionId);
    return url.toString();
  }

  /** The acquirer's answer without anything card-shaped. */
  static safeResponse(answer: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answer)) {
      if (/card|cvc|expir|token|pan|authhash/i.test(key)) continue;
      out[key] = value;
    }
    return out;
  }

  /** Organizations whose subscription Azul renews. */
  static isAzulSubscription(organization: Pick<Organization, 'externalSubscriptionId'>): boolean {
    return Boolean(organization.externalSubscriptionId?.startsWith(SUBSCRIPTION_PREFIX));
  }
}

