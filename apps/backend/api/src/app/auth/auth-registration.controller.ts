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
import { GoogleRecaptchaGuard } from '@nestlab/google-recaptcha';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { AuthFacade } from './auth.facade';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { CookieService } from './services/cookie.service';
import { Public } from '../security/decorators/public.decorator';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { AuthConfig } from './auth.config';
import { RegisterCheckoutDto } from './dto/register-checkout.dto';
import { AddCompanyCheckoutDto } from './dto/add-company-checkout.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import type { BillingPeriod } from '../saas/enums/billing-period.enum';
import { RegisterConfirmDto } from './dto/register-confirm.dto';
import { SetPasswordFromInvitationDto } from './dto/set-password-from-invitation.dto';
import { InvitationDetailsDto } from './dto/security-audit.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { RegistrationPaymentPort } from './ports/registration-payment.port';
import { SaasService } from '../saas/saas.service';
import { FrontendUrlService } from '../mail/frontend-url.service';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../i18n/localized.exception';

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
    private readonly paymentService: RegistrationPaymentPort,
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
    const { plan, priceId } = await this.resolvePlanPrice(dto.planId, dto.billingPeriod);

    // Validate everything and stash a pending registration. NO account yet.
    const pending = await this.authFacade.createPendingRegistration(dto, plan.slug);
    if (!pending) {
      // Honeypot hit — respond as if it succeeded, without a real session.
      return { url: null };
    }

    return this.openCheckout(pending.id, dto.email, priceId, plan, dto.countryCode, res);
  }

  /**
   * A signed-in person adds ANOTHER company: an unrelated legal entity with its own subscription.
   *
   * Not a subsidiary — that is `POST /organizations/subsidiaries`, a company in the same group with
   * no subscription of its own. This one is paid for, so it goes through the same Stripe checkout
   * and the same `register-confirm` as a signup; only the identity differs, and it comes from the
   * session. An impersonating administrator cannot open companies in the person's name.
   */
  @Post('add-company-checkout')
  @AuthenticatedOnly(
    'Cualquier persona con sesión puede pagar una empresa NUEVA a su nombre: no actúa sobre la empresa activa ni sobre sus datos, y la identidad sale de la sesión, no del cuerpo.',
  )
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: AuthConfig.THROTTLE_TTL } })
  @ApiOperation({ summary: 'Start the checkout for an additional company of the signed-in person' })
  async addCompanyCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddCompanyCheckoutDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ url: string | null }> {
    if (user.isImpersonating) {
      throw new ForbiddenError('auth.add_company_not_while_impersonating');
    }
    const { plan, priceId } = await this.resolvePlanPrice(dto.planId, dto.billingPeriod);
    const pending = await this.authFacade.createPendingAdditionalCompany(
      { email: user.email, firstName: user.firstName, lastName: user.lastName },
      dto,
      plan.slug,
    );
    return this.openCheckout(pending.id, user.email, priceId, plan, dto.countryCode, res);
  }

  /** The plan and the Stripe Price for the period asked for, or the reason there is none. */
  private async resolvePlanPrice(planId: string, period: BillingPeriod | undefined) {
    const plans = await this.saasService.getPlans();
    const plan = plans.find((p) => p.id === planId || p.slug === planId);
    if (!plan) {
      throw new BadRequestError('auth.plan_not_found');
    }
    const billingPeriod = period ?? 'monthly';
    const priceId = SaasService.priceIdFor(plan, billingPeriod);
    if (!priceId) {
      throw new BadRequestException(
        billingPeriod === 'annual'
          ? 'Este plan no admite facturación anual en este momento.'
          : 'Este plan no está disponible para contratación en este momento.',
      );
    }
    return { plan, priceId };
  }

  /** Opens the Stripe Checkout for a pending registration and binds it to this browser. */
  private async openCheckout(
    pendingId: string,
    email: string,
    priceId: string,
    plan: { slug: string; trialPeriodDays?: number | null },
    countryCode: string,
    res: Response,
  ): Promise<{ url: string | null }> {
    // Redirect URLs are built server-side. The {CHECKOUT_SESSION_ID} placeholder must stay
    // literal for Stripe to expand it.
    const successUrl = this.links.checkoutComplete();
    const cancelUrl = this.links.registerCancelled();

    const session = await this.paymentService.createRegistrationCheckoutSession({
      email,
      priceId,
      planSlug: plan.slug,
      trialPeriodDays: plan.trialPeriodDays,
      successUrl,
      cancelUrl,
      // Bill the market in its own currency and let Stripe determine the tax. Both were missing,
      // so every customer in all nineteen markets was charged in the Price's default currency with
      // no tax treatment at all.
      currency: SaasService.currencyForCountry(countryCode),
      countryCode,
      metadata: { pendingRegistrationId: pendingId },
    });

    await this.authFacade.attachSessionToPending(pendingId, session.sessionId);

    // Bind this pending registration to THIS browser. `register-confirm` will not issue a session
    // without it, so a leaked Stripe session id is no longer enough to take over the account.
    this.cookieService.setRegistrationTransactionCookie(
      res,
      pendingId,
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
      throw new UnauthorizedError('auth.we_could_not_find_your_registration');
    }

    const session = await this.paymentService.getCheckoutSession(dto.sessionId);

    // Accept paid checkouts and trials (no_payment_required) but never unpaid/open.
    const settled = session.paymentStatus === 'paid' || session.paymentStatus === 'no_payment_required';
    if (session.status !== 'complete' || !settled) {
      throw new BadRequestError('auth.payment_has_not_completed_yet');
    }
    if (!session.pendingRegistrationId) {
      throw new BadRequestError('auth.invalid_registration_session');
    }

    // The cookie and the checkout session must describe the SAME signup. Comparing them stops a
    // caller from pairing their own transaction cookie with somebody else's session id.
    if (session.pendingRegistrationId !== transactionId) {
      this.logger.warn(
        { event: 'register_confirm_transaction_mismatch' },
        '[SECURITY] register-confirm presented a checkout session that does not match its transaction cookie',
      );
      throw new UnauthorizedError('auth.payment_session_does_not_belong_browser');
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
  //
  // The bot check IS applied, and was not: the page obtained a reCAPTCHA token and sent the
  // request without it, so an endpoint that is public, unauthenticated and issues auth cookies had
  // no rate-limiting protection beyond the invitation token itself. `GoogleRecaptchaGuard` honours
  // `RECAPTCHA_DISABLED`, so local checkouts are unaffected.
  @UseGuards(GoogleRecaptchaGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
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

  // `POST /auth/create-checkout-session` lived here: a second implementation of
  // `POST /payment/checkout-session`, without the MANAGE_PAYMENT step-up the canonical one
  // requires, and with no caller. Two routes to the same payment, one of them weaker, is the
  // weaker one's level of protection for both. It was removed rather than hardened.
}
