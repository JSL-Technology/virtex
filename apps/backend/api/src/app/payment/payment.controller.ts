import { Controller, Post, Get, Body, Headers, Req, BadRequestException, UseGuards, Ip, HttpCode, HttpStatus } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PaymentService } from './payment.service';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { StepUp } from '../auth/decorators/step-up.decorator';
import { StepUpScope } from '../auth/enums/step-up-scope.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { SaasService } from '../saas/saas.service';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/decorators/public.decorator';
import { SkipCsrf } from '../auth/decorators/skip-csrf.decorator';
import { CreateCheckoutSessionDto, ConfirmCheckoutDto } from './dto/payment.dto';

@Controller('payment')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly saasService: SaasService,
    private readonly auditTrailService: AuditTrailService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Start a Stripe Checkout session for the caller's organization.
   *
   * The client names a PLAN, not a Stripe price, and does not choose where the browser lands
   * afterwards. Both used to come straight from the request body and straight into Stripe, which
   * made this endpoint a redirect the attacker controls but the victim's browser sees leaving
   * `checkout.stripe.com` — phishing with a genuine payment-processor origin (CWE-601) — and let
   * a caller subscribe to any price on the Stripe account, including internal or test prices.
   * The auth controller already resolved this the right way for signup; this is the same fix.
   */
  @Post('checkout-session')
  @UseGuards(JwtAuthGuard, StepUpGuard)
  @StepUp(StepUpScope.MANAGE_PAYMENT)
  async createCheckoutSession(
    @CurrentUser() user: User,
    @Body() dto: CreateCheckoutSessionDto,
    @Ip() ip: string
  ) {
    if (!user.organizationId) {
        throw new BadRequestException('User does not belong to an organization');
    }

    const plan = (await this.saasService.getPlans()).find((p) => p.slug === dto.planSlug);
    if (!plan) {
      throw new BadRequestException('Plan no encontrado.');
    }
    if (!plan.monthlyPriceId) {
      throw new BadRequestException('Este plan no está disponible para contratación en este momento.');
    }

    const { successUrl, cancelUrl } = this.billingRedirectUrls();

    try {
      const result = await this.paymentService.createCheckoutSession(
        user.organizationId,
        user.email,
        plan.monthlyPriceId,
        successUrl,
        cancelUrl
      );
      await this.auditTrailService.record(user.id, 'Organization', user.organizationId, ActionType.UPDATE, { action: 'create-checkout-session', planSlug: plan.slug }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'Organization', user.organizationId, ActionType.UPDATE, { action: 'create-checkout-session', planSlug: plan.slug, error: (e as Error).message }, undefined, ip, user.organizationId);
      throw e;
    }
  }

  /**
   * Where Stripe sends the browser back to. Built from FRONTEND_URL so the destination is always
   * this application, never a value a caller supplied.
   */
  private billingRedirectUrls(): { successUrl: string; cancelUrl: string } {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL').replace(/\/$/, '');
    return {
      successUrl: `${frontendUrl}/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${frontendUrl}/settings/billing`,
    };
  }

  @Get('overview')
  @UseGuards(JwtAuthGuard)
  async getOverview(@CurrentUser() user: User) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    return this.paymentService.getBillingOverview(user.organizationId);
  }

  @Post('checkout/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmCheckout(
    @CurrentUser() user: User,
    @Body() body: ConfirmCheckoutDto
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    return this.paymentService.confirmOrganizationCheckout(user.organizationId, body.sessionId);
  }

  @Get('invoices')
  @UseGuards(JwtAuthGuard)
  async getInvoices(@CurrentUser() user: User) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    return this.paymentService.getInvoices(user.organizationId);
  }

  @Post('portal-session')
  @UseGuards(JwtAuthGuard, StepUpGuard)
  @StepUp(StepUpScope.MANAGE_PAYMENT)
  async createPortalSession(
    @CurrentUser() user: User,
    @Ip() ip: string
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    // Same reasoning as the checkout session: the return URL is ours to decide, not the caller's.
    const { cancelUrl: returnUrl } = this.billingRedirectUrls();
    try {
      const result = await this.paymentService.createBillingPortalSession(user.organizationId, returnUrl);
      await this.auditTrailService.record(user.id, 'Organization', user.organizationId, ActionType.UPDATE, { action: 'create-portal-session' }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'Organization', user.organizationId, ActionType.UPDATE, { action: 'create-portal-session', error: e.message }, undefined, ip, user.organizationId);
      throw e;
    }
  }

  @Get('config')
  async getConfig() {
    const plans = await this.saasService.getPlans();
    // Transform to expected format if needed, or better, return the plans directly
    // Returning legacy format for backward compatibility + new format
    return {
      prices: {
        starter: plans.find(p => p.slug === 'starter')?.monthlyPriceId,
        pro: plans.find(p => p.slug === 'pro')?.monthlyPriceId,
        enterprise: plans.find(p => p.slug === 'enterprise')?.monthlyPriceId,
      },
      plans: plans
    };
  }

  /**
   * Stripe webhook endpoint.
   *
   * `@Public()` is load-bearing. A global `JwtAuthGuard` is registered as an APP_GUARD, and this
   * route carried no exemption — so every delivery Stripe attempted was answered with 401. The
   * subscription lifecycle simply never reached the application: renewals, failed payments,
   * cancellations and plan changes were all invisible, and `handleSubscriptionUpdated` (which
   * sets the grace period) was unreachable code. Nothing about that failure was visible from
   * inside the product; it showed up only as subscriptions that never changed state.
   *
   * Authentication here is Stripe's signature over the raw body, verified in the adapter, which
   * is stronger than a session cookie would be: it proves the payload came from Stripe unmodified.
   */
  @Public()
  @SkipCsrf()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  async handleWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header.');
    }

    // The signature is computed over the bytes Stripe sent. `rawBody` is populated because the
    // application is created with `rawBody: true`; falling back to the parsed body would mean
    // re-serialising it, which changes key order and whitespace and makes every signature fail.
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException(
        'Raw request body unavailable — the webhook signature cannot be verified.',
      );
    }

    return this.paymentService.handleWebhook(signature, rawBody);
  }
}
