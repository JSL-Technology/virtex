
import { Controller, Post, Body, HttpCode, HttpStatus, Res, Get, UseGuards, Req, UsePipes, ValidationPipe, BadRequestException, UnauthorizedException, ConflictException, Param, ParseUUIDPipe, Query, Ip, Headers, UseFilters, Header, Logger } from '@nestjs/common';
import type { HttpResponse as Response, HttpRequest as Request } from '../common/http/http.types';
import { AuthService } from './auth.service';
import { AuthFacade } from './auth.facade';
import { TwoFactorAuthService } from './services/two-factor-auth.service';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { WebAuthnService } from './services/webauthn.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RequestWithUser } from './interfaces/request-with-user.interface';
import { SocialUser } from './interfaces/social-user.interface';
import { RegisterUserDto } from './dto/register-user.dto';
import { RegisterCheckoutDto } from './dto/register-checkout.dto';
import { RegisterConfirmDto } from './dto/register-confirm.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { JwtAuthGuard } from './guards/jwt/jwt.guard';
import { OptionalJwtAuthGuard } from './guards/jwt/optional-jwt.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { Throttle } from '@nestjs/throttler';
import { GoogleRecaptchaGuard } from '@nestlab/google-recaptcha';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyWebAuthnAuthDto } from './dto/verify-webauthn-auth.dto';
import {
  Verify2faDto,
  SendPublicVerificationDto,
  VerifyPublicCodeDto,
  CreateCheckoutSessionDto,
  VerifyWebAuthnRegistrationDto,
  InvitationDetailsDto,
} from './dto/security-audit.dto';

import {
  ImpersonateDto,
  VerifyEmailCodeDto,
  SendPhoneOtpDto,
  VerifyPhoneOtpDto,
  ConfirmEmailMagicLinkDto,
  WebAuthnLoginOptionsDto,
} from './dto/auth-payloads.dto';
import { SetPasswordFromInvitationDto } from './dto/set-password-from-invitation.dto';
import { StepUpDto } from './dto/step-up.dto';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_POLICY_REGEX,
  PASSWORD_POLICY_MESSAGE,
} from './dto/password-policy';
import { PaymentService } from '../payment/payment.service';
import { SaasService } from '../saas/saas.service';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from './auth.config';
import { TypeOrmExceptionFilter } from '../common/filters/typeorm-exception.filter';
import { CookieService, STEP_UP_COOKIE_NAMES } from './services/cookie.service';
import { FrontendUrlService } from '../mail/frontend-url.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { LoginResponseDto } from './dto/responses/login-response.dto';
import { SessionResponseDto } from './dto/responses/session-response.dto';
import { plainToInstance } from 'class-transformer';
import { EnableTwoFactorDto } from './dto/enable-2fa.dto';
import { CsrfGuard } from './guards/csrf.guard';
import { StepUpGuard } from './guards/step-up.guard';
import { StepUp } from './decorators/step-up.decorator';
import { StepUpScope } from './enums/step-up-scope.enum';
import { HasPermission } from './decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { MfaOrchestratorService } from './services/mfa-orchestrator.service';
import { OauthStateService } from './services/oauth-state.service';
import { OidcProviderService, type OidcClientConfig } from './services/oidc-provider.service';
import { EnterpriseSsoService } from './services/enterprise-sso.service';
import { SsoDiscoverDto } from './dto/sso-discover.dto';
import { JwtService } from '@nestjs/jwt';
import { KeyManagementService } from './services/key-management.service';
import { Public } from './decorators/public.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';
import { TwoFactorRequiredResponseDto } from './dto/login-response.dto';

// H1 FIX: @Public() removed from class level. Only individual public endpoints are decorated
// with @Public(). Authenticated endpoints rely on the global JwtAuthGuard without override.
@ApiTags('Auth')
/**
 * Authentication is never gated on billing.
 *
 * Signing in, signing out, refreshing a session, completing 2FA and reading session state must all
 * work for a tenant whose subscription has lapsed. Otherwise a billing failure locks the customer
 * out of the product entirely — including out of the ability to sign in and pay — and locks them
 * out of ending their own sessions, which is a security control, not a paid feature.
 */
@AllowInactiveSubscription()
@Controller('auth')
@UseFilters(TypeOrmExceptionFilter)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly authFacade: AuthFacade,
    private readonly twoFactorAuthService: TwoFactorAuthService,
    private readonly passwordRecoveryService: PasswordRecoveryService,
    private readonly webAuthnService: WebAuthnService,
    private readonly configService: ConfigService,
    private readonly cookieService: CookieService,
    private readonly mfaOrchestratorService: MfaOrchestratorService,
    private readonly oauthStateService: OauthStateService,
    private readonly oidcProviderService: OidcProviderService,
    private readonly enterpriseSsoService: EnterpriseSsoService,
    private readonly jwtService: JwtService,
    private readonly paymentService: PaymentService,
    private readonly saasService: SaasService,
    private readonly auditTrailService: AuditTrailService,
    private readonly keyManagementService: KeyManagementService,
    // Client routes are declared once, in FrontendUrlService. Every redirect built inline
    // here pointed at a path the router does not have, so the error code was dropped and
    // social sign-up dead-ended.
    private readonly links: FrontendUrlService
  ) {}

  // ------------------------------------------------------------------
  // Social login (Google / Microsoft) — OIDC, stateless handshake.
  //
  // The flow is implemented directly with openid-client + a signed/encrypted
  // transaction cookie (state + nonce + PKCE), NOT Passport. The app runs on Fastify
  // with no server session, so Passport's session-backed `state` cannot work here.
  // Each provider verifies the email once; the existing IAM then issues its own tokens.
  // ------------------------------------------------------------------

  @Public()
  @Get('google')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async googleAuth(@Res() res: Response) {
    return this.startSocialLogin('google', res);
  }

  @Public()
  @Get('google/callback')
  async googleAuthRedirect(@Req() req: Request, @Res() res: Response) {
    return this.handleSocialLoginCallback('google', req, res);
  }

  @Public()
  @Get('microsoft')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async microsoftAuth(@Res() res: Response) {
    return this.startSocialLogin('microsoft', res);
  }

  @Public()
  @Get('microsoft/callback')
  async microsoftAuthRedirect(@Req() req: Request, @Res() res: Response) {
    return this.handleSocialLoginCallback('microsoft', req, res);
  }

  /** Begin a social login: build the IdP authorization URL and set the transaction cookie. */
  private async startSocialLogin(provider: string, res: Response) {
    if (!this.oidcProviderService.isProviderConfigured(provider)) {
      return res.redirect(this.links.login('provider_unavailable'));
    }
    const config = this.oidcProviderService.getProviderConfig(provider);
    const tx = this.oauthStateService.createTransaction(provider);
    const codeChallenge = this.oauthStateService.codeChallengeS256(tx.codeVerifier);
    const authorizationUrl = await this.oidcProviderService.buildAuthorizationUrl(config, {
      state: tx.state,
      nonce: tx.nonce,
      codeChallenge,
    });
    this.oauthStateService.setTransactionCookie(res, tx);
    return res.redirect(authorizationUrl);
  }

  /** Handle the IdP redirect: validate state, exchange code, validate id_token, sign in. */
  private async handleSocialLoginCallback(provider: string, req: Request, res: Response) {
    try {
      const query = (req.query ?? {}) as Record<string, string>;
      if (query.error) {
        throw new UnauthorizedException(query.error_description || query.error);
      }

      const tx = this.oauthStateService.readTransaction(req);
      if (tx.flow !== provider) {
        throw new BadRequestException('OAuth flow mismatch.');
      }
      this.oauthStateService.verifyState(tx.state, query.state);

      if (!query.code) {
        throw new BadRequestException('Missing authorization code.');
      }

      const config = this.oidcProviderService.getProviderConfig(provider);
      const { claims, accessToken } = await this.oidcProviderService.exchangeAndValidate(config, {
        code: query.code,
        codeVerifier: tx.codeVerifier,
        expectedNonce: tx.nonce,
      });

      const socialUser = this.oidcProviderService.mapClaimsToSocialUser(provider, claims, accessToken);
      this.oauthStateService.clearTransactionCookie(res);
      return await this.handleSocialCallback(socialUser, res);
    } catch (err) {
      this.oauthStateService.clearTransactionCookie(res);
      return res.redirect(this.links.login(this.mapSocialErrorToCode(err)));
    }
  }

  /** Translate an internal exception into a safe, non-leaky frontend error code. */
  private mapSocialErrorToCode(err: unknown): string {
    const message = err instanceof Error ? err.message : '';
    if (err instanceof ConflictException) return 'account_exists';
    if (/no ha verificado tu correo|email.*not.*verified/i.test(message)) return 'email_not_verified';
    if (/inactivo|blocked|inactive/i.test(message)) return 'account_inactive';
    return 'oauth_failed';
  }

  private async handleSocialCallback(socialUser: SocialUser, res: Response) {
    const { user, tokens } = await this.authFacade.socialLogin(socialUser);

    if (!user) {
        // Generate a secure, short-lived token to transfer PII safely
        const registerToken = await this.authFacade.generateRegisterToken(socialUser);

        // Use centralised CookieService to avoid inline options drifting out of sync.
        this.cookieService.setSocialRegisterTokenCookie(res, registerToken);

        // Redirect without token in URL
        return res.redirect(this.links.socialRegistration());
    }

    // Login successful
    this.cookieService.setAuthCookies(res, tokens.accessToken, tokens.refreshToken, { userId: user.id });
    return res.redirect(this.links.dashboard());
  }

  // ------------------------------------------------------------------
  // Enterprise SSO (per-tenant OIDC) — Home Realm Discovery + handshake.
  //
  // Each customer organization configures its own IdP (Okta, Entra, Ping, ...). The user
  // enters their work email; the server resolves the org by verified domain and routes them
  // to that org's IdP. The app's IAM remains the source of truth (JIT provisioning + own JWT).
  // ------------------------------------------------------------------

  @Public()
  @Post('sso/discover')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Home Realm Discovery: does an SSO connection exist for this email domain?' })
  async ssoDiscover(@Body() dto: SsoDiscoverDto) {
    const result = await this.enterpriseSsoService.discoverByEmail(dto.email);
    if (!result) {
      // Do not reveal domain/tenant existence — just "no SSO here, use normal login".
      return { ssoAvailable: false };
    }
    return {
      ssoAvailable: true,
      idpName: result.idpName,
      startUrl: `/api/v1/auth/sso/${result.idpId}`,
    };
  }

  @Public()
  @Get('sso/:idpId')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async ssoStart(@Param('idpId') idpId: string, @Res() res: Response) {
    try {
      const idp = await this.enterpriseSsoService.getEnabledIdpOrThrow(idpId);
      const config = this.enterpriseSsoService.buildConfig(idp);
      const tx = this.oauthStateService.createTransaction(`sso:${idpId}`, idp.organizationId);
      const codeChallenge = this.oauthStateService.codeChallengeS256(tx.codeVerifier);
      const authorizationUrl = await this.oidcProviderService.buildAuthorizationUrl(config, {
        state: tx.state,
        nonce: tx.nonce,
        codeChallenge,
      });
      this.oauthStateService.setTransactionCookie(res, tx);
      return res.redirect(authorizationUrl);
    } catch {
      return res.redirect(this.links.login('sso_unavailable'));
    }
  }

  @Public()
  @Get('sso/:idpId/callback')
  async ssoCallback(
    @Param('idpId') idpId: string,
    @Req() req: Request,
    @Res() res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    try {
      const query = (req.query ?? {}) as Record<string, string>;
      if (query.error) {
        throw new UnauthorizedException(query.error_description || query.error);
      }
      const tx = this.oauthStateService.readTransaction(req);
      if (tx.flow !== `sso:${idpId}`) {
        throw new BadRequestException('SSO flow mismatch.');
      }
      this.oauthStateService.verifyState(tx.state, query.state);
      if (!query.code) {
        throw new BadRequestException('Missing authorization code.');
      }

      const idp = await this.enterpriseSsoService.getEnabledIdpOrThrow(idpId);
      const config = this.enterpriseSsoService.buildConfig(idp);
      const { claims, accessToken } = await this.oidcProviderService.exchangeAndValidate(config, {
        code: query.code,
        codeVerifier: tx.codeVerifier,
        expectedNonce: tx.nonce,
      });
      const socialUser = this.oidcProviderService.mapClaimsToSocialUser('sso', claims, accessToken);
      this.oauthStateService.clearTransactionCookie(res);

      const { user: ssoUser, tokens } = await this.enterpriseSsoService.loginOrProvision(idp, socialUser, ip, userAgent);
      this.cookieService.setAuthCookies(res, tokens.accessToken, tokens.refreshToken, { userId: ssoUser?.id });
      return res.redirect(this.links.dashboard());
    } catch (err) {
      this.oauthStateService.clearTransactionCookie(res);
      return res.redirect(this.links.login(this.mapSocialErrorToCode(err)));
    }
  }

  @Public()
  @Get('social-register-info')
  @ApiOperation({ summary: 'Decode social register token to pre-fill form' })
  async getSocialRegisterInfo(@Req() req: Request) {
      // H12 FIX: Read token only from httpOnly cookie; never accept it as a query parameter.
      // Tokens in query strings leak into browser history, server logs, and Referer headers.
      // Accept both the dev (social_register_token) and prod-prefixed (__Host-) cookie names.
      const token = req.cookies['social_register_token'] || req.cookies['__Host-social_register_token'];
      if (!token) {
          throw new BadRequestException('Token de registro no encontrado (cookie requerida)');
      }
      return this.authFacade.getSocialRegisterInfo(token);
  }

  // -----------------------------------------------------------------------------------------
  // There is deliberately NO `POST /auth/register`.
  //
  // It existed, it was @Public(), and it created an organization, its roles and an administrator
  // user without touching Stripe or assigning a plan. Combined with SaaS limits that returned
  // early when an organization had no plan, that was a complete bypass of the product's
  // monetization: anyone could mint an unlimited free tenant with one request, and no screen in
  // the application ever called it, so nothing would have shown the abuse.
  //
  // Signup is `register-checkout` → Stripe → `register-confirm`. The account is materialised only
  // once payment is confirmed. Invitations and social sign-in reach the same materialisation via
  // their own flows, each of which inherits an organization that already has a plan.
  // -----------------------------------------------------------------------------------------

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
      throw new BadRequestException('Plan no encontrado.');
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
      throw new UnauthorizedException(
        'No encontramos tu sesión de registro en este navegador. Inicia sesión con el correo y la contraseña que registraste.',
      );
    }

    const session = await this.paymentService.getCheckoutSession(dto.sessionId);

    // Accept paid checkouts and trials (no_payment_required) but never unpaid/open.
    const settled = session.paymentStatus === 'paid' || session.paymentStatus === 'no_payment_required';
    if (session.status !== 'complete' || !settled) {
      throw new BadRequestException('El pago aún no se ha completado.');
    }
    if (!session.pendingRegistrationId) {
      throw new BadRequestException('Sesión de registro no válida.');
    }

    // The cookie and the checkout session must describe the SAME signup. Comparing them stops a
    // caller from pairing their own transaction cookie with somebody else's session id.
    if (session.pendingRegistrationId !== transactionId) {
      this.logger.warn(
        { event: 'register_confirm_transaction_mismatch' },
        '[SECURITY] register-confirm presented a checkout session that does not match its transaction cookie',
      );
      throw new UnauthorizedException(
        'Esta sesión de pago no corresponde a este navegador. Inicia sesión con tus credenciales.',
      );
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
  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful', type: AuthResponseDto })
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL },
  })
  @UseGuards(GoogleRecaptchaGuard)
  async login(
    @Body() loginUserDto: LoginUserDto,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(loginUserDto, ip, userAgent);

    // Check if 2FA is required
    if ('require2fa' in result && result.require2fa) {
        // H-03 FIX: Deliver pendingId exclusively via httpOnly cookie — never in response body.
        this.cookieService.set2faPendingCookie(res, (result as TwoFactorRequiredResponseDto).pendingId as string);
        this.cookieService.setCsrfCookie(res);
        return { require2fa: true, message: (result as any).message };
    }

    // Narrowing type
    if (!('accessToken' in result)) {
        throw new Error('Unexpected login result');
    }

    const { user, accessToken, refreshToken } = result;
    const rememberMe = loginUserDto.rememberMe || false;

    this.cookieService.setAuthCookies(res, accessToken, refreshToken, { rememberMe, userId: user.id });

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      // accessToken omitted — delivered only via httpOnly cookie
    };
  }

  @Public()
  @Post('set-password-from-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: AuthResponseDto })
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

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiResponse({ type: AuthResponseDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string
  ): Promise<AuthResponseDto> {
    const refreshToken = req.cookies?.['__Secure-refresh_token'] || req.cookies?.refresh_token;
    if (!refreshToken) {
      // No credential was presented, which is 401 — not 400. The request is perfectly well
      // formed; it simply carries nothing to renew. Clearing here matters more than the status
      // code: a browser that reached this point holds a session marker with no refresh token
      // behind it, and would otherwise be told "refreshable" on every bootstrap for the rest of
      // that marker's life.
      this.cookieService.clearAuthCookies(res);
      throw new UnauthorizedException('No hay sesión que renovar.');
    }

    let result: Awaited<ReturnType<AuthService['refreshAccessToken']>>;
    try {
      result = await this.authService.refreshAccessToken(refreshToken, ip, userAgent);
    } catch (error) {
      // Expired, revoked, replayed, or bound to another device: the session is over and cannot
      // be revived. Leaving its cookies in place would make every subsequent page load repeat
      // this exact failure, so the browser is put back into a clean signed-out state and the
      // client is told once, plainly.
      if (error instanceof UnauthorizedException) {
        this.cookieService.clearAuthCookies(res);
      }
      throw error;
    }

    this.cookieService.setAuthCookies(res, result.accessToken, result.refreshToken, {
      userId: result.user?.id,
      // Preserved across the rotation — see SessionService.refreshAccessToken.
      rememberMe: result.rememberMe,
    });

    return {
      user: plainToInstance(UserResponseDto, result.user, { excludeExtraneousValues: true }),
      // accessToken omitted — delivered only via httpOnly cookie
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionId = (user as unknown as AuthenticatedUser).sessionId;
    await this.authService.logoutCurrentSession(user.id, sessionId);
    this.cookieService.clearAuthCookies(res);
    return { message: 'Logout exitoso' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(user.id);
    this.cookieService.clearAuthCookies(res);
    return { message: 'Todas las sesiones han sido cerradas.' };
  }

  /**
   * Re-authenticate for one sensitive action and receive the proof as an httpOnly cookie.
   *
   * This is the single entry point for step-up across the product. It replaces
   * `POST /auth/verify-password`, which only ever accepted a password: on an account with 2FA
   * enabled that was a downgrade, since a password alone is not a second factor. The server
   * decides which factor to demand — see `AuthService.createStepUpToken`.
   */
  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  @ApiOperation({ summary: 'Re-authenticate to authorise a sensitive action' })
  async stepUp(
      @CurrentUser() user: AuthenticatedUser,
      @Body() dto: StepUpDto,
      @Res({ passthrough: true }) res: Response,
  ) {
      const { stepUpToken, maxAgeMs } = await this.authService.createStepUpToken(
          user.id,
          { password: dto.password, otpCode: dto.otpCode },
          dto.scope,
      );

      // The token is delivered as an httpOnly cookie and never enters the response body, so a
      // successful XSS cannot lift a credential that authorises 2FA changes, impersonation,
      // account deletion or session revocation. The client simply calls the sensitive endpoint
      // afterwards; the browser attaches the cookie.
      this.cookieService.setStepUpCookie(res, stepUpToken, maxAgeMs);
      return { success: true, expiresInMs: maxAgeMs };
  }

  /**
   * Begin re-authentication against the account's identity provider.
   *
   * The step-up equivalent of signing in again, for accounts that have no local password and no
   * TOTP secret because their identity lives at an IdP. `prompt=login` and `max_age=0` tell the
   * provider to challenge the user afresh rather than silently re-issuing from an existing SSO
   * session — without them the "re-authentication" would be a redirect that proves nothing.
   *
   * The requested scope travels inside the sealed, httpOnly transaction cookie, not in the query
   * string, so the caller cannot widen it between start and callback.
   */
  @Get('step-up/sso')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Re-authenticate with the identity provider to authorise a sensitive action' })
  async stepUpSsoStart(
    @CurrentUser() user: AuthenticatedUser,
    @Query('scope') scope: string,
    @Query('returnTo') returnTo: string | undefined,
    @Res() res: Response,
  ) {
    if (!Object.values(StepUpScope).includes(scope as StepUpScope)) {
      throw new BadRequestException('Alcance de verificación no válido.');
    }

    const federated = await this.resolveFederatedProvider(user);
    if (!federated) {
      throw new BadRequestException(
        'Esta cuenta no está vinculada a un proveedor de identidad.',
      );
    }

    // Where to put the user back afterwards. It is sealed into the transaction cookie rather
    // than echoed through the IdP, so the caller cannot swap it for somebody else's origin
    // between start and callback (CWE-601).
    const tx = this.oauthStateService.createTransaction(
      `stepup:${federated.flow}:${scope}`,
      user.organizationId,
      returnTo,
    );
    const codeChallenge = this.oauthStateService.codeChallengeS256(tx.codeVerifier);
    const authorizationUrl = await this.oidcProviderService.buildAuthorizationUrl(
      {
        ...federated.config,
        extraAuthParams: {
          ...(federated.config.extraAuthParams ?? {}),
          // Force a fresh authentication at the provider. Both are sent: `prompt=login` is the
          // OIDC-standard instruction, `max_age=0` is what providers that ignore prompt honour.
          prompt: 'login',
          max_age: '0',
          login_hint: user.email,
        },
      },
      { state: tx.state, nonce: tx.nonce, codeChallenge },
    );
    this.oauthStateService.setTransactionCookie(res, tx);
    return res.redirect(authorizationUrl);
  }

  /**
   * Finish IdP re-authentication and deliver the step-up proof as an httpOnly cookie.
   *
   * The identity the provider returns must be the identity already signed in here. Without that
   * check, a user could authenticate as somebody else at the IdP and receive a step-up token for
   * their own session.
   */
  @Get('step-up/sso/callback')
  @UseGuards(JwtAuthGuard)
  async stepUpSsoCallback(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const query = (req.query ?? {}) as Record<string, string>;
      if (query.error) {
        throw new UnauthorizedException(query.error_description || query.error);
      }

      const tx = this.oauthStateService.readTransaction(req);
      const [marker, provider, scope] = tx.flow.split(':');
      if (marker !== 'stepup' || !provider || !scope) {
        throw new BadRequestException('Flujo de verificación no válido.');
      }
      this.oauthStateService.verifyState(tx.state, query.state);
      if (!query.code) {
        throw new BadRequestException('Falta el código de autorización.');
      }

      const federated = await this.resolveFederatedProvider(user);
      if (!federated || federated.flow !== provider) {
        throw new UnauthorizedException('El proveedor de identidad no coincide.');
      }

      const { claims } = await this.oidcProviderService.exchangeAndValidate(federated.config, {
        code: query.code,
        codeVerifier: tx.codeVerifier,
        expectedNonce: tx.nonce,
      });

      // The provider must have re-authenticated the SAME person. Email is compared
      // case-insensitively because providers differ on the casing they return.
      const returnedEmail = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
      if (!returnedEmail || returnedEmail !== user.email.toLowerCase()) {
        this.logger.warn(
          { event: 'step_up_sso_subject_mismatch', userId: user.id },
          '[SECURITY] IdP re-authentication returned a different identity than the signed-in user',
        );
        throw new UnauthorizedException('La identidad verificada no coincide con tu sesión.');
      }

      this.oauthStateService.clearTransactionCookie(res);

      const { stepUpToken, maxAgeMs } = this.authService.issueStepUpTokenAfterFederatedReauth(
        user.id,
        scope as StepUpScope,
      );
      this.cookieService.setStepUpCookie(res, stepUpToken, maxAgeMs);
      return res.redirect(this.links.stepUpComplete(scope, tx.returnTo));
    } catch (err) {
      this.oauthStateService.clearTransactionCookie(res);
      this.logger.warn(
        { event: 'step_up_sso_failed', reason: (err as Error).message },
        '[SECURITY] IdP re-authentication for step-up failed',
      );
      // `tx` may not have been read yet, so the return path is recovered defensively.
      let failedReturnTo: string | undefined;
      try {
        failedReturnTo = this.oauthStateService.readTransaction(req).returnTo;
      } catch {
        failedReturnTo = undefined;
      }
      return res.redirect(this.links.stepUpFailed(failedReturnTo));
    }
  }

  /**
   * The OIDC client configuration to re-authenticate this user against.
   *
   * The organization's enterprise IdP takes precedence over a social provider: an account that
   * belongs to a tenant with SSO configured must re-authenticate there, not against whichever
   * consumer provider it happened to sign up with.
   */
  private async resolveFederatedProvider(
    user: AuthenticatedUser,
  ): Promise<{ flow: string; config: OidcClientConfig } | null> {
    const discovered = await this.enterpriseSsoService.discoverByEmail(user.email);
    if (discovered) {
      const idp = await this.enterpriseSsoService.getEnabledIdpOrThrow(discovered.idpId);
      return {
        flow: `sso-${discovered.idpId}`,
        // The step-up flow has its own callback, so the config's sign-in redirect URI is
        // replaced. It must match on both the authorization request and the token exchange.
        config: {
          ...this.enterpriseSsoService.buildConfig(idp),
          redirectUri: this.oidcProviderService.stepUpRedirectUri(),
        },
      };
    }

    const fullUser = await this.authService.findUserForStepUp(user.id);
    const provider = fullUser?.authProvider;
    if (provider && this.oidcProviderService.isProviderConfigured(provider)) {
      return {
        flow: provider,
        config: {
          ...this.oidcProviderService.getProviderConfig(provider),
          redirectUri: this.oidcProviderService.stepUpRedirectUri(),
        },
      };
    }
    return null;
  }

  /**
   * Which factor the client must collect before calling `POST /auth/step-up`.
   *
   * Without this the client has to guess, and guessing wrong means the user is shown a password
   * prompt for an account that requires a TOTP code — a dead end with no way forward.
   */
  @Get('step-up/challenge')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Ask which factor step-up will require for this account' })
  async stepUpChallenge(@CurrentUser() user: AuthenticatedUser) {
      return this.authService.describeStepUpChallenge(user.id);
  }

  /**
   * Whether a usable step-up proof for this scope is already held.
   *
   * The proof lives in an httpOnly cookie the client cannot read, and federated
   * re-authentication is a full page navigation that destroys whatever the client was about to
   * do. Asking the server is what lets the client resume after the IdP sends the user back —
   * and it also stops a second prompt appearing for a proof that is still valid.
   *
   * Reading a token is not spending it: single-use scopes are burned by `StepUpGuard` on the
   * guarded route, never here.
   */
  @Get('step-up/status')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Is a step-up proof for this scope already held?' })
  stepUpStatus(
      @CurrentUser() user: AuthenticatedUser,
      @Query('scope') scope: string,
      @Req() req: Request,
  ) {
      if (!Object.values(StepUpScope).includes(scope as StepUpScope)) {
          throw new BadRequestException('Alcance de verificación no válido.');
      }
      const cookies = req.cookies as Record<string, string | undefined> | undefined;
      const token = STEP_UP_COOKIE_NAMES.map((name) => cookies?.[name]).find(Boolean);
      return this.authService.verifyStepUpToken(token, user.id, scope as StepUpScope);
  }

  /**
   * Session bootstrap: what session does this browser have?
   *
   * This replaces `GET /auth/status`, which was `JwtAuthGuard`-protected and therefore answered
   * the most common state the application is ever in — nobody signed in — with 401. The client
   * could not distinguish "your access token just expired" from "you have never signed in", so it
   * responded to both by firing `POST /auth/refresh`, which for a signed-out visitor could only
   * fail as well. Loading the login page cost two failed requests, and did so on every guard
   * evaluation. None of it indicated a fault: a 401 has to mean something is wrong, or it means
   * nothing at all, and an error rate that is always red is an error rate nobody reads.
   *
   * So the question is now asked of an endpoint that always answers, and answers completely:
   *
   *   - `authenticated` — resolved by the same `JwtStrategy` as every protected route, through
   *     {@link OptionalJwtAuthGuard}, which reports absence instead of rejecting it. An expired or
   *     tampered token is indistinguishable from none: both are simply "not authenticated".
   *   - `refreshable` — whether a silent refresh is worth attempting, read from the session marker
   *     cookie. This is what removes the guessing: the client calls `POST /auth/refresh` only when
   *     the server has said it can succeed.
   *   - the CSRF token — reissued on every call, bound to whoever turned out to be signed in.
   *
   * That last point closes a real gap rather than merely quieting the console. The token used to
   * be minted only alongside a session, so a browser holding a session cookie but no readable
   * XSRF cookie — cleared cookies, a rotated `CSRF_SECRET`, a token bound to a user who has since
   * signed out — could never satisfy `CsrfGuard` again. `POST /auth/refresh` answered 403 for the
   * rest of that cookie's life and the only exit was clearing site data by hand. Bootstrap now
   * hands out a valid, correctly bound token before the SPA needs one, so that state repairs
   * itself on the next page load.
   *
   * `@Public()` exempts it from the global `JwtAuthGuard`; `OptionalJwtAuthGuard` then resolves
   * the principal when there is one. The response is `no-store` — it is per-browser session state
   * and must never be served from a cache — and it discloses nothing to an anonymous caller
   * beyond what that caller already sent.
   */
  @Public()
  @Get('session')
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Report the caller\'s session state. Always 200 — "signed out" is an answer, not an error.',
  })
  @ApiResponse({ status: 200, type: SessionResponseDto })
  async getSession(
    @CurrentUser() user: AuthenticatedUser | null,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;

    if (user) {
      try {
        // Re-read from the source of truth: a role change, a deactivation or an organization
        // switch must reach the client on the next page load, not at token expiry.
        const { user: freshUser } = await this.authService.status(user);
        this.cookieService.setCsrfCookie(res, freshUser.id);
        return {
          authenticated: true,
          user: plainToInstance(UserResponseDto, freshUser, { excludeExtraneousValues: true }),
          // Nothing to renew: the access token presented with this request is valid.
          refreshable: false,
        };
      } catch (error) {
        // The token verified but the principal behind it no longer may sign in — deactivated,
        // locked, deleted. Only that case: an infrastructure failure must still surface as 5xx
        // rather than being reported to the user as "you are signed out".
        if (!(error instanceof UnauthorizedException)) {
          throw error;
        }
        this.logger.log(
          { event: 'session_principal_rejected', userId: user.id },
          'Session bootstrap: token valid but principal is no longer authenticable',
        );
        // Cookies for a session that cannot be revived are worse than no cookies: they would keep
        // this browser reporting `refreshable` forever.
        this.cookieService.clearAuthCookies(res);
        this.cookieService.setCsrfCookie(res);
        return { authenticated: false, user: null, refreshable: false };
      }
    }

    this.cookieService.setCsrfCookie(res);
    return {
      authenticated: false,
      user: null,
      refreshable: this.cookieService.hasSessionMarker(cookies),
    };
  }

  // Fase 3.1: Expose the password policy as the single source of truth so the frontend can
  // align its validators without hardcoding rules (preventing permanent drift between client
  // and server). The policy is not sensitive — it is already enforced server-side and visible
  // in client validation. Public + cacheable.
  /**
   * JWKS endpoint (RFC 7517).
   *
   * Publishing the public half of the signing key ring lets other services validate access
   * tokens locally without sharing the private key, and makes key rotation propagate on its own
   * instead of requiring a coordinated redeploy. Public by definition — it contains only public
   * keys — and cacheable, but only briefly, so a rotation is picked up quickly.
   */
  @Public()
  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Public JSON Web Key Set used to verify access tokens' })
  getJwks() {
    return this.keyManagementService.getJwks();
  }

  @Public()
  @Get('password-policy')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'Get the password policy enforced by the backend' })
  getPasswordPolicy() {
    return {
      minLength: PASSWORD_MIN_LENGTH,
      maxLength: PASSWORD_MAX_LENGTH,
      // Expose the regex source so clients can mirror it exactly if desired.
      pattern: PASSWORD_POLICY_REGEX.source,
      message: PASSWORD_POLICY_MESSAGE,
    };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(GoogleRecaptchaGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  @UsePipes(new ValidationPipe())
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    await this.passwordRecoveryService.sendPasswordResetLink(forgotPasswordDto);
    return {
      message:
        'Si existe una cuenta con ese correo, se ha enviado un enlace para restablecer la contraseña.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe())
  // No CsrfGuard — the reset token (SHA-256 of 32 random bytes) is proof-of-possession.
  // Users performing a password reset typically have no active session and therefore
  // no XSRF-TOKEN cookie. OWASP explicitly exempts endpoints already protected by
  // a one-time secret from requiring additional CSRF protection.
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    const user = await this.passwordRecoveryService.resetPassword(resetPasswordDto);
    // Return only whitelisted fields — never expose security entity (passwordHash,
    // twoFactorSecret, backupCodes, etc.) regardless of what the ORM loaded.
    return plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true });
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.CHANGE_PASSWORD)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe())
  @ApiOperation({ summary: 'Change password for authenticated user' })
  async changePassword(
      @CurrentUser() user: AuthenticatedUser,
      @Body() changePasswordDto: ChangePasswordDto,
      @Ip() ip: string
  ) {
      try {
          await this.authService.changePassword(user.id, changePasswordDto.currentPassword, changePasswordDto.newPassword);
          await this.auditTrailService.record(user.id, 'User', user.id, ActionType.UPDATE, { action: 'change-password' }, undefined, ip, user.organizationId);
          return { message: 'Password updated successfully' };
      } catch (e) {
          await this.auditTrailService.record(user.id, 'User', user.id, ActionType.UPDATE, { action: 'change-password', error: (e as Error).message }, undefined, ip, user.organizationId);
          throw e;
      }
  }

  // Impersonation grants complete access to another person's data and attributes the resulting
  // actions to them, so it carries the strongest protections available:
  //   - PermissionsGuard        the operator must hold users:impersonate
  //   - StepUpGuard             a fresh, single-use proof of the operator's own identity, using
  //                             the strongest factor their account holds (TOTP when 2FA is on,
  //                             the password otherwise)
  // ImpersonationService additionally refuses any target whose permissions the operator does
  // not already hold, so the feature cannot be used to gain privileges.
  @Post('impersonate')
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.IMPERSONATE)
  @HasPermission(PERMISSIONS.USERS_IMPERSONATE)
  async impersonate(
    @CurrentUser() adminUser: AuthenticatedUser,
    @Body() dto: ImpersonateDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const { user, accessToken, refreshToken } =
      await this.authFacade.impersonate(adminUser, dto.userId);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken, { userId: user?.id });

    // H-06 FIX: Never expose access_token in the response body, and sanitize the user via DTO.
    // All token delivery is cookie-only to prevent XSS token exfiltration (OWASP ASVS 3.4.3; CWE-200).
    return { user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }) };
  }

  @Post('stop-impersonation')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async stopImpersonation(
    @CurrentUser() impersonatingUser: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response
  ) {
    const { user, accessToken, refreshToken } =
      await this.authFacade.stopImpersonation(impersonatingUser);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken, { userId: user?.id });

    // H-06 FIX: Never expose access_token in the response body (OWASP ASVS 3.4.3; CWE-200).
    return { user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }) };
  }

  // ------------------------------------------------------------------
  // Two-Factor Authentication (MFA)
  // ------------------------------------------------------------------

  @Post('2fa/generate')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Generate 2FA secret and QR code URL' })
  async generateTwoFactorSecret(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactorAuthService.generateTwoFactorSecret(user);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.ENABLE_2FA)
  @ApiOperation({ summary: 'Verify the code and enable 2FA — re-authentication is handled by StepUpGuard' })
  async enableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() enableTwoFactorDto: EnableTwoFactorDto,
    @Ip() ip: string
  ) {
    try {
      // No password is passed: StepUpGuard has already re-authenticated this caller with the
      // strongest factor the account holds, and burned the token doing it.
      const result = await this.twoFactorAuthService.enableTwoFactor(user, enableTwoFactorDto.token);
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'enable-2fa' }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'enable-2fa', error: (e as Error).message }, undefined, ip, user.organizationId);
      throw e;
    }
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.DISABLE_2FA)
  @ApiOperation({ summary: 'Disable 2FA' })
  async disableTwoFactor(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    try {
      const result = await this.twoFactorAuthService.disableTwoFactor(user);
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'disable-2fa' }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'disable-2fa', error: (e as Error).message }, undefined, ip, user.organizationId);
      throw e;
    }
  }

  @Post('2fa/backup-codes/generate')
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.REGENERATE_BACKUP_CODES)
  @ApiOperation({ summary: 'Generate new backup codes' })
  async generateBackupCodes(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    try {
      const result = await this.twoFactorAuthService.generateBackupCodes(user);
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'generate-backup-codes' }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'generate-backup-codes', error: (e as Error).message }, undefined, ip, user.organizationId);
      throw e;
    }
  }

  @Post('2fa/send-email-verification')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Send email verification code for 2FA setup' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async sendEmailVerification(@CurrentUser() user: AuthenticatedUser) {
    await this.mfaOrchestratorService.sendEmailOtp(user.id, user.email);
    return { message: 'Verification code sent to email' };
  }

  @Post('2fa/verify-email-verification')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Verify email code for 2FA setup' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyEmailVerification(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyEmailCodeDto) {
    return this.mfaOrchestratorService.verifyEmailOtp(user.id, dto.code);
  }

  @Post('send-phone-otp')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async sendPhoneOtp(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendPhoneOtpDto) {
      // Presence + E.164 format are now enforced by SendPhoneOtpDto via the global ValidationPipe.
      const { phoneNumber } = dto;

      // Prevent SMS bombing: if the user already has a verified phone registered,
      // only allow sending OTP to that same number or to a new unverified one.
      // Sending to an arbitrary third-party number is not permitted.
      if (user.isPhoneVerified && user.phone && user.phone !== phoneNumber) {
          throw new BadRequestException('Cannot send OTP to a phone number not associated with your account');
      }

      await this.mfaOrchestratorService.sendPhoneOtp(user.id, phoneNumber);
      return { message: 'OTP sent successfully' };
  }

  @Post('verify-phone')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyPhoneOtp(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyPhoneOtpDto) {
      // Use MfaOrchestratorService directly instead of AuthService pass-through
      return this.mfaOrchestratorService.verifyPhoneOtp(user.id, dto.code, dto.phoneNumber);
  }

  @Post('send-public-verification')
  @Public()
  @UseGuards(ThrottlerGuard, GoogleRecaptchaGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Send a verification code for unauthenticated users (email or phone)' })
  async sendPublicVerification(
    @Body() dto: SendPublicVerificationDto
  ) {
    await this.mfaOrchestratorService.sendPublicVerification(dto.target, dto.type);
    return { message: 'Si los datos son correctos, se ha enviado un código de verificación.' };
  }

  @Post('verify-public-code')
  @Public()
  @UseGuards(ThrottlerGuard, GoogleRecaptchaGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify a public code for unauthenticated users' })
  async verifyPublicCode(
    @Body() dto: VerifyPublicCodeDto
  ) {
    return this.mfaOrchestratorService.verifyPublicCode(dto.target, dto.type, dto.code);
  }

  @Post('confirm-email-magic-link')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify a registration email confirmation magic link' })
  async confirmEmailMagicLink(@Body() dto: ConfirmEmailMagicLinkDto) {
    return this.mfaOrchestratorService.confirmEmailMagicLink(dto.token);
  }

  @Post('create-checkout-session')
  @ApiOperation({ summary: 'Create a Stripe checkout session for a selected plan' })
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateCheckoutSessionDto
  ) {
    const plans = await this.saasService.getPlans();
    const plan = plans.find(p => p.id === body.planId || p.slug === body.planId);
    if (!plan) {
      throw new BadRequestException('Plan not found');
    }

    const priceId = SaasService.priceIdFor(plan, body.billingPeriod ?? 'monthly');
    if (!priceId) {
      throw new BadRequestException('Este plan no admite ese periodo de facturación.');
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

  @Post('verify-2fa')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verify2fa(
      @Body() dto: Verify2faDto,
      @Req() req: Request,
      @Res({ passthrough: true }) res: Response,
      @Ip() ip: string,
      @Headers('user-agent') userAgent: string
  ) {
      // H-03 FIX: Read pendingId from httpOnly cookie — never accept tempToken from body.
      // The cookie name is owned by CookieService: it depends on the environment and has changed
      // once already (the `__Host-` prefix is incompatible with the path this cookie needs), so
      // reading it by literal name here is how the two sides drift apart.
      const pendingId = this.cookieService.read2faPendingId((req as any).cookies);
      if (!pendingId) {
          throw new UnauthorizedException('No active 2FA session — please log in again');
      }

      // Loads the pending session and counts the attempt, but does NOT destroy it — a mistyped
      // code must not force the user to restart the whole login.
      const user = await this.authService.consume2faPendingSession(pendingId, ip, userAgent);

      const authResult = await this.mfaOrchestratorService.complete2faLogin(user, dto.code, ip, userAgent);

      const { user: authUser, accessToken, refreshToken } = authResult;

      // The second factor is verified: the pending session has served its purpose and must not
      // be replayable.
      await this.authService.clear2faPendingSession(pendingId);
      this.cookieService.clear2faPendingCookie(res);
      this.cookieService.setAuthCookies(res, accessToken, refreshToken, { userId: authUser?.id });
      // Through the DTO, like every other auth response. `buildSafeUser` only strips the
      // `security` relation, so returning its output directly leaked `invitationToken`,
      // `invitationTokenExpires` and `authProviderId` — and it did so on the ONE response that
      // completes a second-factor login (CWE-200).
      return { user: plainToInstance(UserResponseDto, authUser, { excludeExtraneousValues: true }) };
  }

  // ------------------------------------------------------------------
  // WebAuthn (Passkeys)
  // ------------------------------------------------------------------

  @Get('webauthn/register/options')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate WebAuthn registration options' })
  async generateWebAuthnRegistrationOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.webAuthnService.generateRegistrationOptions(user);
  }

  // H3 FIX: WebAuthn credential binding is a critical MFA mutation; requires CSRF + step-up 2FA.
  @Post('webauthn/register/verify')
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.REGISTER_PASSKEY)
  @ApiOperation({ summary: 'Verify WebAuthn registration' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyWebAuthnRegistration(@CurrentUser() user: AuthenticatedUser, @Body() body: VerifyWebAuthnRegistrationDto) {
    return this.webAuthnService.verifyRegistration(user, body);
  }

  // H10 FIX: WebAuthn challenge generation must be rate-limited to prevent oracle/enumeration abuse.
  @Public()
  @Post('webauthn/login/options')
  @ApiOperation({ summary: 'Generate WebAuthn authentication options' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async generateWebAuthnAuthenticationOptions(@Body() dto: WebAuthnLoginOptionsDto) {
    return this.webAuthnService.generateAuthenticationOptions(dto.email);
  }

  @Public()
  @Post('webauthn/login/verify')
  @ApiOperation({ summary: 'Verify WebAuthn authentication' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  @UseGuards(CsrfGuard)
  async verifyWebAuthnAuthentication(
    @Body() body: VerifyWebAuthnAuthDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.webAuthnService.verifyAuthentication(body);
    const user = result.user;

    // FIDO2/WebAuthn is inherently multi-factor (possession + biometric/PIN = NIST AAL2).
    // However, if the user has explicitly configured TOTP or SMS 2FA, we honour that
    // organisational policy by requiring the second factor before issuing session cookies.
    if (user.security?.isTwoFactorEnabled) {
      // H-03 FIX: Same cookie-based pending session as the password login flow.
      const pendingId = await this.authService.create2faPendingSession(user, undefined, undefined);
      this.cookieService.set2faPendingCookie(res, pendingId);
      return { require2fa: true, message: '2FA verification required' };
    }

    const { accessToken, refreshToken } = await this.authFacade.generateTokens(user);
    this.cookieService.setAuthCookies(res, accessToken, refreshToken, { userId: user.id });

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      // accessToken OMITTED — available exclusively via the __Host-access_token cookie (CWE-200)
    };
  }

  // ------------------------------------------------------------------
  // Session Management
  // ------------------------------------------------------------------

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List active sessions (devices)' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async getUserSessions(@CurrentUser() user: AuthenticatedUser) {
      // The current session comes from the access token's `sessionId` claim.
      //
      // This previously decoded the refresh-token cookie to read its `jti`, which could never
      // work: that cookie is path-scoped to /api/v1/auth/refresh, so the browser does not send it
      // to this endpoint. `currentRefreshTokenId` was therefore always undefined and every row
      // rendered with isCurrent=false, leaving the user unable to tell which device they were on.
      // The claim is always present and, since the session-family change, stable across rotation.
      return this.authService.getUserSessions(user.id, user.sessionId);
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.REVOKE_SESSION)
  @ApiOperation({ summary: 'Revoke every session except the current one' })
  async revokeOtherSessions(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    await this.authService.terminateOtherSessions(user.id, user.sessionId);
    await this.auditTrailService.record(
      user.id, 'Session', user.id, ActionType.DELETE,
      { action: 'revoke-other-sessions' }, undefined, ip, user.organizationId,
    );
    return { message: 'Se han cerrado las demás sesiones.' };
  }

  @Post('sessions/:id/revoke') // Using POST or DELETE is fine, usually DELETE for resource removal
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.REVOKE_SESSION)
  @ApiOperation({ summary: 'Revoke a specific session' })
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Ip() ip: string
  ) {
    try {
      const result = await this.authService.revokeSession(user.id, sessionId);
      await this.auditTrailService.record(user.id, 'Session', sessionId, ActionType.DELETE, { action: 'revoke-session' }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'Session', sessionId, ActionType.DELETE, { action: 'revoke-session', error: (e as Error).message }, undefined, ip, user.organizationId);
      throw e;
    }
  }
}
