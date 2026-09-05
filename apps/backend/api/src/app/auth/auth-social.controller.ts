import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  Param,
  Ip,
  Headers,
  UseGuards,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import type { HttpResponse as Response, HttpRequest as Request } from '../common/http/http.types';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthFacade } from './auth.facade';
import { SocialUser } from './interfaces/social-user.interface';
import { CookieService } from './services/cookie.service';
import { OauthStateService } from './services/oauth-state.service';
import { OidcProviderService } from './services/oidc-provider.service';
import { EnterpriseSsoService } from './services/enterprise-sso.service';
import { Public } from './decorators/public.decorator';
import { SsoDiscoverDto } from './dto/sso-discover.dto';
import { FrontendUrlService } from '../mail/frontend-url.service';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';
import { BadRequestError } from '../i18n/localized.exception';

/**
 * Federated sign-in: consumer social login (Google / Microsoft) and per-tenant enterprise SSO.
 *
 * Both are OIDC with a signed/encrypted transaction cookie (state + nonce + PKCE) rather than
 * Passport sessions — the app runs on Fastify with no server session. They live together because
 * they share the same handshake and the same safe error-code mapper. Split out of `AuthController`;
 * every route keeps its exact guards and throttles. `@AllowInactiveSubscription` because signing in
 * is never gated on billing.
 */
@ApiTags('Auth')
@AllowInactiveSubscription()
@Controller('auth')
export class AuthSocialController {
  constructor(
    private readonly authFacade: AuthFacade,
    private readonly cookieService: CookieService,
    private readonly oauthStateService: OauthStateService,
    private readonly oidcProviderService: OidcProviderService,
    private readonly enterpriseSsoService: EnterpriseSsoService,
    private readonly links: FrontendUrlService,
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
        throw new BadRequestError('AUTH.OAUTH_FLOW_MISMATCH');
      }
      this.oauthStateService.verifyState(tx.state, query.state);

      if (!query.code) {
        throw new BadRequestError('AUTH.MISSING_AUTHORIZATION_CODE');
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

  @Public()
  @Get('social-register-info')
  @ApiOperation({ summary: 'Decode social register token to pre-fill form' })
  async getSocialRegisterInfo(@Req() req: Request) {
      // H12 FIX: Read token only from httpOnly cookie; never accept it as a query parameter.
      // Tokens in query strings leak into browser history, server logs, and Referer headers.
      // Accept both the dev (social_register_token) and prod-prefixed (__Host-) cookie names.
      const token = req.cookies['social_register_token'] || req.cookies['__Host-social_register_token'];
      if (!token) {
          throw new BadRequestError('AUTH.TOKEN_REGISTRO_NO_ENCONTRADO_COOKIE_REQUERIDA');
      }
      return this.authFacade.getSocialRegisterInfo(token);
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
        throw new BadRequestError('AUTH.SSO_FLOW_MISMATCH');
      }
      this.oauthStateService.verifyState(tx.state, query.state);
      if (!query.code) {
        throw new BadRequestError('AUTH.MISSING_AUTHORIZATION_CODE');
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
}
