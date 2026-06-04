
import { Controller, Post, Body, HttpCode, HttpStatus, Res, Get, UseGuards, Req, UsePipes, ValidationPipe, BadRequestException, UnauthorizedException, ConflictException, Param, Ip, Headers, UseFilters, Header } from '@nestjs/common';
import type { Response, Request } from 'express';
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
import { CookieService } from './services/cookie.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { LoginResponseDto } from './dto/responses/login-response.dto';
import { plainToInstance } from 'class-transformer';
import { EnableTwoFactorDto } from './dto/enable-2fa.dto';
import { CsrfGuard } from './guards/csrf.guard';
import { PermissionsGuard } from './guards/permissions/permissions.guard';
import { HasPermission } from './decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { MfaOrchestratorService } from './services/mfa-orchestrator.service';
import { OauthStateService } from './services/oauth-state.service';
import { OidcProviderService } from './services/oidc-provider.service';
import { EnterpriseSsoService } from './services/enterprise-sso.service';
import { SsoDiscoverDto } from './dto/sso-discover.dto';
import { JwtService } from '@nestjs/jwt';
import { TwoFactorVerifiedGuard } from './guards/two-factor-verified.guard';
import { Public } from './decorators/public.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

// H1 FIX: @Public() removed from class level. Only individual public endpoints are decorated
// with @Public(). Authenticated endpoints rely on the global JwtAuthGuard without override.
@ApiTags('Auth')
@Controller('auth')
@UseFilters(TypeOrmExceptionFilter)
export class AuthController {
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
    private readonly saasService: SaasService
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
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    if (!this.oidcProviderService.isProviderConfigured(provider)) {
      return res.redirect(`${frontendUrl}/auth/login?error=provider_unavailable`);
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
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
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
      const code = this.mapSocialErrorToCode(err);
      return res.redirect(`${frontendUrl}/auth/login?error=${code}`);
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
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');

    if (!user) {
        // Generate a secure, short-lived token to transfer PII safely
        const registerToken = await this.authFacade.generateRegisterToken(socialUser);

        // Use centralised CookieService to avoid inline options drifting out of sync.
        this.cookieService.setSocialRegisterTokenCookie(res, registerToken);

        // Redirect without token in URL
        return res.redirect(`${frontendUrl}/auth/register?social_registration=true`);
    }

    // Login successful
    this.cookieService.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res.redirect(`${frontendUrl}/dashboard`);
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
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
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
      return res.redirect(`${frontendUrl}/auth/login?error=sso_unavailable`);
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
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
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

      const { tokens } = await this.enterpriseSsoService.loginOrProvision(idp, socialUser, ip, userAgent);
      this.cookieService.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
      return res.redirect(`${frontendUrl}/dashboard`);
    } catch (err) {
      this.oauthStateService.clearTransactionCookie(res);
      return res.redirect(`${frontendUrl}/auth/login?error=${this.mapSocialErrorToCode(err)}`);
    }
  }

  @Public()
  @Get('social-register-info')
  @Public()
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

  @Public()
  @Post('register')
  @Public()
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Register a new user and organization' })
  @ApiResponse({ status: 201, description: 'User successfully registered.', type: AuthResponseDto })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async register(
    @Body() registerUserDto: RegisterUserDto,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string
  ): Promise<AuthResponseDto> {
    const result = await this.authFacade.register(registerUserDto, ip, userAgent);

    // H18 FIX: Honeypot returns a flag; do not set real cookies with fake tokens.
    if ('honeypot' in result && result.honeypot) {
      return {
        user: plainToInstance(UserResponseDto, result.user, { excludeExtraneousValues: true }),
      };
    }

    const { user, accessToken, refreshToken } = result as { user: any; accessToken: string; refreshToken: string };
    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      // 10/10 SECURITY: accessToken is NOT returned in the body — it is delivered only via the
      // httpOnly cookie, reducing XSS exfiltration surface.
    };
  }

  @Post('register-checkout')
  @Public()
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Validate signup and start Stripe Checkout — no account is created until payment succeeds' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async registerCheckout(@Body() dto: RegisterCheckoutDto): Promise<{ url: string | null }> {
    const plans = await this.saasService.getPlans();
    const plan = plans.find((p) => p.id === dto.planId || p.slug === dto.planId);
    if (!plan) {
      throw new BadRequestException('Plan no encontrado.');
    }
    if (!plan.monthlyPriceId) {
      throw new BadRequestException('Este plan no está disponible para contratación en este momento.');
    }

    // Validate everything and stash a pending registration. NO account yet.
    const pending = await this.authFacade.createPendingRegistration(dto, plan.slug);
    if (!pending) {
      // Honeypot hit — respond as if it succeeded, without a real session.
      return { url: null };
    }

    // H-02: redirect URLs are built server-side from FRONTEND_URL. The
    // {CHECKOUT_SESSION_ID} placeholder must stay literal for Stripe to expand.
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL').replace(/\/$/, '');
    const successUrl = `${frontendUrl}/auth/checkout-complete?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl}/auth/register`;

    const session = await this.paymentService.createRegistrationCheckoutSession({
      email: dto.email,
      priceId: plan.monthlyPriceId,
      planSlug: plan.slug,
      trialPeriodDays: plan.trialPeriodDays,
      successUrl,
      cancelUrl,
      metadata: { pendingRegistrationId: pending.id },
    });

    await this.authFacade.attachSessionToPending(pending.id, session.sessionId);

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
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string
  ): Promise<AuthResponseDto> {
    const session = await this.paymentService.getCheckoutSession(dto.sessionId);

    // Accept paid checkouts and trials (no_payment_required) but never unpaid/open.
    const settled = session.paymentStatus === 'paid' || session.paymentStatus === 'no_payment_required';
    if (session.status !== 'complete' || !settled) {
      throw new BadRequestException('El pago aún no se ha completado.');
    }
    if (!session.pendingRegistrationId) {
      throw new BadRequestException('Sesión de registro no válida.');
    }

    const user = await this.authFacade.completePendingRegistration(session.pendingRegistrationId, {
      customerId: session.customerId as string,
      subscriptionId: session.subscriptionId,
      status: session.subscriptionStatus || 'active',
      currentPeriodEnd: session.currentPeriodEnd,
    });

    const { accessToken, refreshToken, user: safeUser } = await this.authFacade.generateTokens(user, ip, userAgent);
    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    return {
      user: plainToInstance(UserResponseDto, safeUser, { excludeExtraneousValues: true }),
    };
  }

  @Public()
  @Post('login')
  @Public()
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
        this.cookieService.set2faPendingCookie(res, (result as any).pendingId);
        this.cookieService.setCsrfCookie(res);
        return { require2fa: true, message: (result as any).message };
    }

    // Narrowing type
    if (!('accessToken' in result)) {
        throw new Error('Unexpected login result');
    }

    const { user, accessToken, refreshToken } = result;
    const rememberMe = loginUserDto.rememberMe || false;

    this.cookieService.setAuthCookies(res, accessToken, refreshToken, rememberMe);

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      // accessToken omitted — delivered only via httpOnly cookie
    };
  }

  @Public()
  @Post('set-password-from-invitation')
  @Public()
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

    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

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
      throw new BadRequestException('Refresh token no encontrado en cookies');
    }

    const result = await this.authService.refreshAccessToken(refreshToken, ip, userAgent);

    this.cookieService.setAuthCookies(res, result.accessToken, result.refreshToken);

    return {
      user: plainToInstance(UserResponseDto, result.user, { excludeExtraneousValues: true }),
      // accessToken omitted — delivered only via httpOnly cookie
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async logout(
    @CurrentUser() user: User,
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
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(user.id);
    this.cookieService.clearAuthCookies(res);
    return { message: 'Todas las sesiones han sido cerradas.' };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  async checkAuthStatus(@CurrentUser() user: User) {
    const statusResponse = await this.authService.status(user as unknown as AuthenticatedUser);
    return {
      isAuthenticated: true,
      user: plainToInstance(UserResponseDto, statusResponse.user, { excludeExtraneousValues: true }),
    };
  }

  // Fase 3.1: Expose the password policy as the single source of truth so the frontend can
  // align its validators without hardcoding rules (preventing permanent drift between client
  // and server). The policy is not sensitive — it is already enforced server-side and visible
  // in client validation. Public + cacheable.
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
  @Public()
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
  @Public()
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
  @UseGuards(JwtAuthGuard, CsrfGuard, TwoFactorVerifiedGuard)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe())
  @ApiOperation({ summary: 'Change password for authenticated user' })
  async changePassword(
      @CurrentUser() user: User,
      @Body() changePasswordDto: ChangePasswordDto
  ) {
      await this.authService.changePassword(user.id, changePasswordDto.currentPassword, changePasswordDto.newPassword);
      return { message: 'Password updated successfully' };
  }

  // L-09 FIX: Impersonation is one of the most sensitive operations — require step-up 2FA
  // re-authentication (TwoFactorVerifiedGuard), consistent with session revocation, 2FA
  // disable, user edit/delete and passkey registration.
  @Post('impersonate')
  @UseGuards(JwtAuthGuard, CsrfGuard, PermissionsGuard, TwoFactorVerifiedGuard)
  @HasPermission(PERMISSIONS.USERS_IMPERSONATE)
  async impersonate(
    @CurrentUser() adminUser: User,
    @Body() dto: ImpersonateDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const { user, accessToken, refreshToken } =
      await this.authFacade.impersonate(adminUser, dto.userId);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    // H-06 FIX: Never expose access_token in the response body, and sanitize the user via DTO.
    // All token delivery is cookie-only to prevent XSS token exfiltration (OWASP ASVS 3.4.3; CWE-200).
    return { user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }) };
  }

  @Post('stop-impersonation')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async stopImpersonation(
    @CurrentUser() impersonatingUser: User,
    @Res({ passthrough: true }) res: Response
  ) {
    const { user, accessToken, refreshToken } =
      await this.authFacade.stopImpersonation(impersonatingUser);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    // H-06 FIX: Never expose access_token in the response body (OWASP ASVS 3.4.3; CWE-200).
    return { user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }) };
  }

  // ------------------------------------------------------------------
  // Two-Factor Authentication (MFA)
  // ------------------------------------------------------------------

  @Post('2fa/generate')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Generate 2FA secret and QR code URL' })
  async generateTwoFactorSecret(@CurrentUser() user: User) {
    return this.twoFactorAuthService.generateTwoFactorSecret(user);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Verify token and enable 2FA — requires current password as step-up' })
  async enableTwoFactor(
    @CurrentUser() user: User,
    @Body() enableTwoFactorDto: EnableTwoFactorDto,
  ) {
    // H-05 FIX: Pass currentPassword for step-up verification inside the service
    return this.twoFactorAuthService.enableTwoFactor(user, enableTwoFactorDto.token, enableTwoFactorDto.currentPassword);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard, CsrfGuard, TwoFactorVerifiedGuard)
  @ApiOperation({ summary: 'Disable 2FA' })
  async disableTwoFactor(@CurrentUser() user: User) {
    return this.twoFactorAuthService.disableTwoFactor(user);
  }

  @Post('2fa/backup-codes/generate')
  @UseGuards(JwtAuthGuard, CsrfGuard, TwoFactorVerifiedGuard)
  @ApiOperation({ summary: 'Generate new backup codes' })
  async generateBackupCodes(@CurrentUser() user: User) {
    return this.twoFactorAuthService.generateBackupCodes(user);
  }

  @Post('2fa/send-email-verification')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Send email verification code for 2FA setup' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async sendEmailVerification(@CurrentUser() user: User) {
    await this.mfaOrchestratorService.sendEmailOtp(user.id, user.email);
    return { message: 'Verification code sent to email' };
  }

  @Post('2fa/verify-email-verification')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Verify email code for 2FA setup' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyEmailVerification(@CurrentUser() user: User, @Body() dto: VerifyEmailCodeDto) {
    return this.mfaOrchestratorService.verifyEmailOtp(user.id, dto.code);
  }

  @Post('send-phone-otp')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async sendPhoneOtp(@CurrentUser() user: User, @Body() dto: SendPhoneOtpDto) {
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
  async verifyPhoneOtp(@CurrentUser() user: User, @Body() dto: VerifyPhoneOtpDto) {
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
    @CurrentUser() user: User,
    @Body() body: CreateCheckoutSessionDto
  ) {
    const plans = await this.saasService.getPlans();
    const plan = plans.find(p => p.id === body.planId || p.slug === body.planId);
    if (!plan) {
      throw new BadRequestException('Plan not found');
    }

    const priceId = plan.monthlyPriceId;
    if (!priceId) {
      throw new BadRequestException('Plan does not have a price ID');
    }

    // H-02 FIX: Build redirect URLs server-side from FRONTEND_URL.
    // Never pass client-supplied URLs to Stripe — the backend must control
    // where users land after checkout (CWE-601; OWASP Unvalidated Redirects).
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const successUrl = new URL('/dashboard', frontendUrl).toString();
    const cancelUrl = new URL('/auth/register', frontendUrl).toString();

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
      const pendingId = (req as any).cookies?.['__Host-2fa_pending'] || (req as any).cookies?.['2fa_pending'];
      if (!pendingId) {
          throw new UnauthorizedException('No active 2FA session — please log in again');
      }

      const user = await this.authService.consume2faPendingSession(pendingId, ip, userAgent);

      const authResult = await this.mfaOrchestratorService.complete2faLogin(user, dto.code, ip, userAgent);

      const { user: authUser, accessToken, refreshToken } = authResult;

      this.cookieService.clear2faPendingCookie(res);
      this.cookieService.setAuthCookies(res, accessToken, refreshToken);
      return { user: authUser };
  }

  // ------------------------------------------------------------------
  // WebAuthn (Passkeys)
  // ------------------------------------------------------------------

  @Get('webauthn/register/options')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate WebAuthn registration options' })
  async generateWebAuthnRegistrationOptions(@CurrentUser() user: User) {
    return this.webAuthnService.generateRegistrationOptions(user);
  }

  // H3 FIX: WebAuthn credential binding is a critical MFA mutation; requires CSRF + step-up 2FA.
  @Post('webauthn/register/verify')
  @UseGuards(JwtAuthGuard, CsrfGuard, TwoFactorVerifiedGuard)
  @ApiOperation({ summary: 'Verify WebAuthn registration' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyWebAuthnRegistration(@CurrentUser() user: User, @Body() body: VerifyWebAuthnRegistrationDto) {
    return this.webAuthnService.verifyRegistration(user, body);
  }

  // H10 FIX: WebAuthn challenge generation must be rate-limited to prevent oracle/enumeration abuse.
  @Public()
  @Post('webauthn/login/options')
  @Public()
  @ApiOperation({ summary: 'Generate WebAuthn authentication options' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async generateWebAuthnAuthenticationOptions(@Body() dto: WebAuthnLoginOptionsDto) {
    return this.webAuthnService.generateAuthenticationOptions(dto.email);
  }

  @Public()
  @Post('webauthn/login/verify')
  @Public()
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
    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

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
  async getUserSessions(@CurrentUser() user: User, @Req() req: Request) {
      let currentRefreshTokenId: string | undefined;
      const token = req.cookies['__Secure-refresh_token'] || req.cookies['refresh_token'];
      if (token) {
          try {
             // We decode to get the 'jti' (ID)
             const payload: any = this.jwtService.decode(token);
             if (payload && payload.jti) {
                 currentRefreshTokenId = payload.jti;
             }
          } catch(e) {}
      }
      return this.authService.getUserSessions(user.id, currentRefreshTokenId);
  }

  @Post('sessions/:id/revoke') // Using POST or DELETE is fine, usually DELETE for resource removal
  @UseGuards(JwtAuthGuard, CsrfGuard, TwoFactorVerifiedGuard)
  @ApiOperation({ summary: 'Revoke a specific session' })
  async revokeSession(
    @CurrentUser() user: User,
    @Param('id') sessionId: string,
  ) {
    return this.authService.revokeSession(user.id, sessionId);
  }
}
