import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  Header,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import type { HttpResponse as Response, HttpRequest as Request } from '../common/http/http.types';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { AuthService } from './auth.service';
import { AuthFacade } from './auth.facade';
import { CookieService, STEP_UP_COOKIE_NAMES } from './services/cookie.service';
import { OauthStateService } from './services/oauth-state.service';
import { OidcProviderService, type OidcClientConfig } from './services/oidc-provider.service';
import { EnterpriseSsoService } from './services/enterprise-sso.service';
import { JwtAuthGuard } from './guards/jwt/jwt.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { StepUpGuard } from './guards/step-up.guard';
import { StepUp } from './decorators/step-up.decorator';
import { StepUpScope } from './enums/step-up-scope.enum';
import { HasPermission } from './decorators/permissions.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { StepUpDto } from './dto/step-up.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { ImpersonateDto } from './dto/auth-payloads.dto';
import { FrontendUrlService } from '../mail/frontend-url.service';
import { PERMISSIONS } from '../shared/permissions';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';
import { BadRequestError, UnauthorizedError } from '../i18n/localized.exception';

/**
 * Step-up re-authentication and impersonation.
 *
 * Step-up is the single entry point for re-authenticating one sensitive action across the product:
 * the server decides which factor to demand (TOTP when 2FA is on, the password otherwise, the IdP
 * for a federated account) and delivers the proof as an httpOnly cookie that never enters
 * JavaScript. Impersonation carries the strongest protections available (permission + fresh,
 * single-use step-up). Split out of `AuthController`; every route keeps its exact guards and
 * scopes. `@AllowInactiveSubscription` because these are security controls, not paid features.
 */
@ApiTags('Auth')
@AllowInactiveSubscription()
@Controller('auth')
export class AuthStepUpController {
  private readonly logger = new Logger(AuthStepUpController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly authFacade: AuthFacade,
    private readonly cookieService: CookieService,
    private readonly oauthStateService: OauthStateService,
    private readonly oidcProviderService: OidcProviderService,
    private readonly enterpriseSsoService: EnterpriseSsoService,
    private readonly links: FrontendUrlService,
  ) {}

  /**
   * Re-authenticate for one sensitive action and receive the proof as an httpOnly cookie.
   *
   * This is the single entry point for step-up across the product. The server decides which factor
   * to demand — see `AuthService.createStepUpToken`.
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
   * provider to challenge the user afresh. The requested scope travels inside the sealed, httpOnly
   * transaction cookie, not in the query string, so the caller cannot widen it between start and
   * callback.
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
      throw new BadRequestError('AUTH.ALCANCE_VERIFICACION_NO_VALIDO');
    }

    const federated = await this.resolveFederatedProvider(user);
    if (!federated) {
      throw new BadRequestError('AUTH.ESTA_CUENTA_NO_ESTA_VINCULADA_PROVEEDOR_IDENTIDAD');
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
        throw new BadRequestError('AUTH.FLUJO_VERIFICACION_NO_VALIDO');
      }
      this.oauthStateService.verifyState(tx.state, query.state);
      if (!query.code) {
        throw new BadRequestError('AUTH.FALTA_CODIGO_AUTORIZACION');
      }

      const federated = await this.resolveFederatedProvider(user);
      if (!federated || federated.flow !== provider) {
        throw new UnauthorizedError('AUTH.PROVEEDOR_IDENTIDAD_NO_COINCIDE');
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
        throw new UnauthorizedError('AUTH.IDENTIDAD_VERIFICADA_NO_COINCIDE_TU_SESION');
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
          throw new BadRequestError('AUTH.ALCANCE_VERIFICACION_NO_VALIDO');
      }
      const cookies = req.cookies as Record<string, string | undefined> | undefined;
      const token = STEP_UP_COOKIE_NAMES.map((name) => cookies?.[name]).find(Boolean);
      return this.authService.verifyStepUpToken(token, user.id, scope as StepUpScope);
  }

  // Impersonation grants complete access to another person's data and attributes the resulting
  // actions to them, so it carries the strongest protections available:
  //   - PermissionsGuard        the operator must hold users:impersonate
  //   - StepUpGuard             a fresh, single-use proof of the operator's own identity
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
}
