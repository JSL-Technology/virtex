
import { Controller, Post, Body, HttpCode, HttpStatus, Res, Get, UseGuards, Req, UsePipes, ValidationPipe, UnauthorizedException, Ip, Headers, Header, Logger } from '@nestjs/common';
import type { HttpResponse as Response, HttpRequest as Request } from '../common/http/http.types';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { GoogleRecaptchaGuard } from '@nestlab/google-recaptcha';
import { LoginUserDto } from './dto/login-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt/jwt.guard';
import { OptionalJwtAuthGuard } from './guards/jwt/optional-jwt.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { StepUpGuard } from './guards/step-up.guard';
import { StepUp } from './decorators/step-up.decorator';
import { StepUpScope } from './enums/step-up-scope.enum';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { CookieService } from './services/cookie.service';
import { KeyManagementService } from './services/key-management.service';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_POLICY_REGEX,
  PASSWORD_POLICY_MESSAGE,
} from './dto/password-policy';
import { AuthConfig } from './auth.config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { LoginResponseDto } from './dto/responses/login-response.dto';
import { SessionResponseDto } from './dto/responses/session-response.dto';
import { plainToInstance } from 'class-transformer';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';
import { TwoFactorRequiredResponseDto } from './dto/login-response.dto';
import { UnauthorizedError } from '../i18n/localized.exception';

// H1 FIX: @Public() removed from class level. Only individual public endpoints are decorated
// with @Public(). Authenticated endpoints rely on the global JwtAuthGuard without override.
@ApiTags('Auth')
/**
 * Core credential and session lifecycle: sign in, refresh, sign out, session bootstrap, the
 * password policy, JWKS, password recovery and password change.
 *
 * The rest of the authentication surface — registration/checkout, federated sign-in (social + SSO),
 * MFA, step-up/impersonation, WebAuthn and session (device) management — lives in its own cohesive
 * controller alongside this one, each mounted on `@Controller('auth')`. They were split out of a
 * single 1,400-line controller so no one file owns unrelated concerns; every route kept its exact
 * guards, scopes and throttles.
 *
 * Authentication is never gated on billing. Signing in, signing out, refreshing a session,
 * completing 2FA and reading session state must all work for a tenant whose subscription has
 * lapsed — otherwise a billing failure locks the customer out of the product entirely, including
 * out of the ability to sign in and pay. Hence `@AllowInactiveSubscription()`.
 */
@AllowInactiveSubscription()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly passwordRecoveryService: PasswordRecoveryService,
    private readonly cookieService: CookieService,
    private readonly auditTrailService: AuditTrailService,
    private readonly keyManagementService: KeyManagementService,
  ) {}

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
      throw new UnauthorizedError('AUTH.NO_HAY_SESION_RENOVAR');
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
    return { messageKey: 'AUTH.LOGOUT_EXITOSO' };
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
    return { messageKey: 'AUTH.TODAS_SESIONES_HAN_CERRADAS' };
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
          return { messageKey: 'AUTH.PASSWORD_UPDATED_SUCCESSFULLY' };
      } catch (e) {
          await this.auditTrailService.record(user.id, 'User', user.id, ActionType.UPDATE, { action: 'change-password', error: (e as Error).message }, undefined, ip, user.organizationId);
          throw e;
      }
  }

  /**
   * Session bootstrap: what session does this browser have?
   *
   * Always answers 200 — "signed out" is an answer, not an error. `@Public()` exempts it from the
   * global `JwtAuthGuard`; `OptionalJwtAuthGuard` then resolves the principal when there is one.
   * The response is `no-store` and discloses nothing to an anonymous caller beyond what that caller
   * already sent.
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

  /**
   * JWKS endpoint (RFC 7517).
   *
   * Publishing the public half of the signing key ring lets other services validate access
   * tokens locally without sharing the private key, and makes key rotation propagate on its own.
   * Public by definition — it contains only public keys — and briefly cacheable.
   */
  @Public()
  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Public JSON Web Key Set used to verify access tokens' })
  getJwks() {
    return this.keyManagementService.getJwks();
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
  @HttpCode(HttpStatus.OK)
  @UseGuards(GoogleRecaptchaGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  @UsePipes(new ValidationPipe())
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    await this.passwordRecoveryService.sendPasswordResetLink(forgotPasswordDto);
    return {
      messageKey: 'AUTH.SI_EXISTE_CUENTA_CON_ESE_CORREO_ENVIADO_ENLACE',
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
}
