import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
  Ip,
  Headers,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { HttpResponse as Response, HttpRequest as Request } from '../common/http/http.types';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { AuthFacade } from './auth.facade';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { CookieService } from './services/cookie.service';
import { JwtAuthGuard } from './guards/jwt/jwt.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { AuthConfig } from './auth.config';
import { RegisterCheckoutDto } from './dto/register-checkout.dto';
import { RegisterConfirmDto } from './dto/register-confirm.dto';
import { SetPasswordFromInvitationDto } from './dto/set-password-from-invitation.dto';
import { AuthCreateCheckoutSessionDto, InvitationDetailsDto } from './dto/security-audit.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { PaymentService } from '../payment/payment.service';
import { SaasService } from '../saas/saas.service';
import { FrontendUrlService } from '../mail/frontend-url.service';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';
import { BadRequestError, UnauthorizedError } from '../i18n/localized.exception';

/**
 * Signup and checkout.
 *
 * There is deliberately NO `POST /auth/register`. It existed, it was `@Public()`, and it created an
 * organization, its roles and an administrator user without touching Stripe or assigning a plan —
 * a complete bypass of the product's monetization. Signup is `register-checkout` → Stripe →
 * `register-confirm`: the account is materialised only once payment is confirmed. Invitations and
 * social sign-in reach the same materialisation via their own flows.
 *
 * Split out of `AuthController`; every route keeps its exact guards and throttles.
 * `@AllowInactiveSubscription` so a lapsed tenant can still open a checkout and pay.
 */
@ApiTags('Auth')
@AllowInactiveSubscription()
@Controller('auth')
export class AuthRegistrationController {
  private readonly logger = new Logger(AuthRegistrationController.name);

  constructor(
    private readonly authFacade: AuthFacade,
    private readonly passwordRecoveryService: PasswordRecoveryService,
    private readonly cookieService: CookieService,
    private readonly paymentService: PaymentService,
    private readonly saasService: SaasService,
    // Client routes are declared once, in FrontendUrlService, so redirects cannot point at a path
    // the router does not have.
    private readonly links: FrontendUrlService,
  ) {}

  @Post('register-checkout')
  @Public()
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Validate signup and start Stripe Checkout — no account is created until payment succeeds' })
  // Deliberately looser than the credential endpoints. This route validates a nineteen-field
  // fiscal form and rejects it field by field, so a customer correcting an RFC, then a régimen
  // fiscal, then a postal code legitimately submits it several times in a row — and at the shared
  // limit of five a minute the funnel closed on them, mid-correction, with a 429. There is no
  // credential to guess here; abuse is covered by reCAPTCHA and by the fact that nothing is
  // created until Stripe confirms a payment.
  @Throttle({ default: { limit: 20, ttl: AuthConfig.THROTTLE_TTL } })
  async registerCheckout(
    @Body() dto: RegisterCheckoutDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ url: string | null }> {
    const plans = await this.saasService.getPlans();
    const plan = plans.find((p) => p.id === dto.planId || p.slug === dto.planId);
    if (!plan) {
      throw new BadRequestError('AUTH.PLAN_NO_ENCONTRADO');
    }
    const billingPeriod = dto.billingPeriod ?? 'monthly';
    const priceId = SaasService.priceIdFor(plan, billingPeriod);
    if (!priceId) {
      throw new BadRequestException(
        billingPeriod === 'annual'
          ? 'Este plan no admite facturación anual en este momento.'
          : 'Este plan no está disponible para contratación en este momento.',
      );
    }

    // Validate everything and stash a pending registration. NO account yet.
    const pending = await this.authFacade.createPendingRegistration(dto, plan.slug);
    if (!pending) {
      // Honeypot hit — respond as if it succeeded, without a real session.
      return { url: null };
    }

    // Redirect URLs are built server-side. The {CHECKOUT_SESSION_ID} placeholder must stay
    // literal for Stripe to expand it.
    const successUrl = this.links.checkoutComplete();
    const cancelUrl = this.links.registerCancelled();

    const session = await this.paymentService.createRegistrationCheckoutSession({
      email: dto.email,
      priceId,
      planSlug: plan.slug,
      trialPeriodDays: plan.trialPeriodDays,
      successUrl,
      cancelUrl,
      // Bill the market in its own currency and let Stripe determine the tax. Both were missing,
      // so every customer in all nineteen markets was charged in the Price's default currency with
      // no tax treatment at all.
      currency: SaasService.currencyForCountry(dto.countryCode),
      countryCode: dto.countryCode,
      metadata: { pendingRegistrationId: pending.id },
    });

    await this.authFacade.attachSessionToPending(pending.id, session.sessionId);

    // Bind this pending registration to THIS browser. `register-confirm` will not issue a session
    // without it, so a leaked Stripe session id is no longer enough to take over the account.
    this.cookieService.setRegistrationTransactionCookie(
      res,
      pending.id,
      AuthConfig.PENDING_REGISTRATION_TTL,
    );

    return { url: session.url };
  }

  @Post('register-confirm')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Finalize signup after a successful payment and auto-login' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async registerConfirm(
    @Body() dto: RegisterConfirmDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string
  ): Promise<AuthResponseDto> {
    // Proof that this browser is the one that started the checkout.
    //
    // Without it the Stripe `session_id` alone minted a full owner session — and that id reaches
    // the browser in a query string, so it lands in history, in the `Referer` sent to any
    // third-party resource on the landing page, and in every proxy log in between. It also never
    // stopped working: once the account exists, `completePendingRegistration` returns the existing
    // user, so the same id could be replayed for a session weeks later.
    const transactionId = this.cookieService.readRegistrationTransactionId(
      (req as unknown as { cookies?: Record<string, string | undefined> }).cookies,
    );
    if (!transactionId) {
      throw new UnauthorizedError('AUTH.NO_ENCONTRAMOS_TU_SESION_REGISTRO_ESTE_NAVEGADOR');
    }

    const session = await this.paymentService.getCheckoutSession(dto.sessionId);

    // Accept paid checkouts and trials (no_payment_required) but never unpaid/open.
    const settled = session.paymentStatus === 'paid' || session.paymentStatus === 'no_payment_required';
    if (session.status !== 'complete' || !settled) {
      throw new BadRequestError('AUTH.PAGO_AUN_NO_HA_COMPLETADO');
    }
    if (!session.pendingRegistrationId) {
      throw new BadRequestError('AUTH.SESION_REGISTRO_NO_VALIDA');
    }

    // The cookie and the checkout session must describe the SAME signup. Comparing them stops a
    // caller from pairing their own transaction cookie with somebody else's session id.
    if (session.pendingRegistrationId !== transactionId) {
      this.logger.warn(
        { event: 'register_confirm_transaction_mismatch' },
        '[SECURITY] register-confirm presented a checkout session that does not match its transaction cookie',
      );
      throw new UnauthorizedError('AUTH.ESTA_SESION_PAGO_NO_CORRESPONDE_ESTE_NAVEGADOR');
    }

    const user = await this.authFacade.completePendingRegistration(session.pendingRegistrationId, {
      customerId: session.customerId as string,
      subscriptionId: session.subscriptionId,
      status: session.subscriptionStatus || 'active',
      currentPeriodEnd: session.currentPeriodEnd,
    });

    const { accessToken, refreshToken, user: safeUser } = await this.authFacade.generateTokens(user, ip, userAgent);
    this.cookieService.setAuthCookies(res, accessToken, refreshToken, { userId: user.id });
    // Single use: the transaction has served its purpose and must not be replayable.
    this.cookieService.clearRegistrationTransactionCookie(res);

    return {
      user: plainToInstance(UserResponseDto, safeUser, { excludeExtraneousValues: true }),
    };
  }

  @Public()
  @Post('set-password-from-invitation')
  @HttpCode(HttpStatus.OK)
  // No CsrfGuard — the invitationToken is proof-of-possession (SHA-256, 32 bytes).
  // New users have never logged in and therefore have no XSRF-TOKEN cookie.
  async setPasswordFromInvitation(
    @Body() setPasswordDto: SetPasswordFromInvitationDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const { user, accessToken, refreshToken } =
      await this.authFacade.setPasswordFromInvitation(setPasswordDto);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken, { userId: user.id });

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      // accessToken OMITTED — available exclusively via the __Host-access_token cookie (CWE-200)
    };
  }

  // H4/H-02 FIX: Token moved from URL path (:token) to POST body — path/query params are
  // logged by reverse proxies, CDNs, and browsers, exposing the secret (CWE-598; OWASP ASVS 2.1.7).
  @Public()
  @Post('invitation/details')
  @HttpCode(HttpStatus.OK)
  async getInvitationDetails(@Body() dto: InvitationDetailsDto) {
    return this.passwordRecoveryService.getInvitationDetails(dto.token);
  }

  @Post('create-checkout-session')
  @ApiOperation({ summary: 'Create a Stripe checkout session for a selected plan' })
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AuthCreateCheckoutSessionDto
  ) {
    const plans = await this.saasService.getPlans();
    const plan = plans.find(p => p.id === body.planId || p.slug === body.planId);
    if (!plan) {
      throw new BadRequestError('AUTH.PLAN_NOT_FOUND');
    }

    const priceId = SaasService.priceIdFor(plan, body.billingPeriod ?? 'monthly');
    if (!priceId) {
      throw new BadRequestError('AUTH.ESTE_PLAN_NO_ADMITE_ESE_PERIODO_FACTURACION');
    }

    // Redirect URLs are built server-side. Never pass client-supplied URLs to Stripe — the
    // backend must control where users land after checkout (CWE-601).
    const successUrl = this.links.billing(true);
    const cancelUrl = this.links.billing();

    return this.paymentService.createCheckoutSession(
      user.organizationId,
      user.email,
      priceId,
      successUrl,
      cancelUrl
    );
  }
}
