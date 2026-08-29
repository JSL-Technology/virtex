import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthConfig, isDevLikeEnvironment } from '../auth.config';
import * as crypto from 'crypto';

/** Binding value used when a CSRF token is minted outside an authenticated session. */
const ANONYMOUS_BINDING = 'anon';

/**
 * Cookie names carrying the step-up token, most-secure first. Both are checked on read so a
 * dev/prod switch cannot strand a session, and only one is ever written.
 */
export const STEP_UP_COOKIE_NAMES = ['__Host-step_up', 'step_up'] as const;

export interface SetAuthCookiesOptions {
  rememberMe?: boolean;
  /**
   * Subject the CSRF token is bound to. See {@link CookieService.generateSignedCsrfToken}.
   * Always pass it when the authenticated user is known.
   */
  userId?: string;
}

@Injectable()
export class CookieService {
  constructor(private readonly configService: ConfigService) {}

  /** True when cookies may be issued without the Secure attribute (plain-HTTP local dev). */
  private isInsecureDevEnvironment(): boolean {
    return isDevLikeEnvironment() && this.configService.get('NODE_ENV') !== 'production';
  }

  setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string | null,
    options: SetAuthCookiesOptions = {},
  ): void {
    const { rememberMe = false, userId } = options;
    const insecureDev = this.isInsecureDevEnvironment();

    // Strict cookie settings: HttpOnly always, Secure everywhere except local plain-HTTP dev.
    // SameSite=Lax (not Strict) is required so the OAuth/OIDC callback redirect from Google,
    // Microsoft or an enterprise IdP still carries the cookies. CSRF is covered separately by
    // the signed double-submit token below.
    //
    // H-15: __Host-/__Secure- prefixes mandate Secure=true, which browsers reject over plain
    // HTTP. Use prefixed names only when we actually set Secure (RFC 6265bis §4.1.3).
    const accessTokenName = insecureDev ? 'access_token' : '__Host-access_token';
    const refreshTokenName = insecureDev ? 'refresh_token' : '__Secure-refresh_token';

    const baseOptions = {
      httpOnly: true,
      secure: !insecureDev,
      sameSite: 'lax' as 'strict' | 'lax' | 'none',
      path: '/',
    };

    res.cookie(accessTokenName, accessToken, {
      ...baseOptions,
      maxAge: AuthConfig.COOKIE_ACCESS_MAX_AGE,
    });

    if (refreshToken) {
      res.cookie(refreshTokenName, refreshToken, {
        ...baseOptions,
        maxAge: rememberMe
          ? AuthConfig.COOKIE_REFRESH_REMEMBER_ME_MAX_AGE
          : AuthConfig.COOKIE_REFRESH_MAX_AGE,
        // Path-scoped so the long-lived refresh token is not attached to every API call.
        path: '/api/v1/auth/refresh',
      });
    }

    this.setCsrfCookie(res, userId);
  }

  setCsrfCookie(res: Response, userId?: string): void {
    const csrfToken = this.generateSignedCsrfToken(userId);
    res.cookie('XSRF-TOKEN', csrfToken, {
      secure: !this.isInsecureDevEnvironment(),
      sameSite: 'lax',
      // Must stay readable by JS: the SPA copies it into the X-XSRF-TOKEN header.
      httpOnly: false,
      // C-1 FIX: previously COOKIE_ACCESS_MAX_AGE (15m). Because POST /auth/refresh is
      // CSRF-protected and the Angular interceptor only sends the header when it can read this
      // cookie, a 15-minute lifetime made every refresh after that point fail with 403 — which
      // the interceptor turns into a logout. Sessions could never outlive 15 minutes and
      // "remember me" was inert. The CSRF cookie must outlive the refresh token.
      maxAge: AuthConfig.COOKIE_CSRF_MAX_AGE,
      path: '/',
    });
  }

  /**
   * Signed double-submit CSRF token: `nonce.binding.HMAC(secret, nonce:binding)`.
   *
   * The signature stops an attacker who controls a sibling subdomain from injecting an
   * arbitrary XSRF-TOKEN cookie, because they cannot forge the HMAC.
   *
   * `binding` additionally ties the token to a specific user. Without it, a signed token is
   * universally valid: an attacker could mint one from their own account and reuse it against a
   * victim's session, which is exactly the case OWASP's "Signed Double-Submit Cookie" recipe
   * warns about (it recommends including the session identifier in the HMAC input).
   * Tokens minted before authentication carry `anon` and are only accepted on endpoints that
   * have no authenticated principal.
   */
  generateSignedCsrfToken(userId?: string): string {
    const nonce = crypto.randomBytes(32).toString('hex');
    const binding = userId || ANONYMOUS_BINDING;
    return `${nonce}.${binding}.${this.signCsrf(nonce, binding)}`;
  }

  /**
   * Verify a CSRF token's signature and, when the request is authenticated, its binding.
   *
   * @param token           Value presented in both the cookie and the X-XSRF-TOKEN header.
   * @param currentUserId   Authenticated principal, when one exists.
   */
  verifyCsrfToken(token: string, currentUserId?: string): boolean {
    const parts = token?.split('.') ?? [];
    if (parts.length !== 3) return false;

    const [nonce, binding, signature] = parts;
    if (!nonce || !binding || !signature) return false;

    if (!this.timingSafeEqualHex(signature, this.signCsrf(nonce, binding))) {
      return false;
    }

    // A token minted for one user must not be replayable against another's session.
    // `anon` tokens are accepted only where there is no authenticated principal.
    if (currentUserId) {
      return binding === currentUserId;
    }

    return true;
  }

  private signCsrf(nonce: string, binding: string): string {
    return crypto
      .createHmac('sha256', AuthConfig.CSRF_SECRET)
      .update(`${nonce}:${binding}`)
      .digest('hex');
  }

  /** Constant-time hex comparison that tolerates malformed input without throwing. */
  private timingSafeEqualHex(a: string, b: string): boolean {
    try {
      const bufA = Buffer.from(a, 'hex');
      const bufB = Buffer.from(b, 'hex');
      // timingSafeEqual throws on length mismatch; a differing length is itself a mismatch.
      if (bufA.length !== bufB.length || bufA.length === 0) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  // Social-login registration token (OAuth register flow). Distinct from setRegisterTokenCookie.
  setSocialRegisterTokenCookie(res: Response, token: string): void {
    const insecureDev = this.isInsecureDevEnvironment();
    const name = insecureDev ? 'social_register_token' : '__Host-social_register_token';
    res.cookie(name, token, {
      httpOnly: true,
      secure: !insecureDev,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
      path: '/',
    });
  }

  setRegisterTokenCookie(res: Response, token: string): void {
    // Previously hardcoded `__Host-` + Secure=true, which browsers silently drop over plain
    // HTTP — breaking the local registration flow. Now consistent with every other cookie here.
    const insecureDev = this.isInsecureDevEnvironment();
    const name = insecureDev ? 'register_token' : '__Host-register_token';
    res.cookie(name, token, {
      httpOnly: true,
      secure: !insecureDev,
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
  }

  // H-03: the 2FA pending-session id is delivered as an httpOnly cookie so it never reaches
  // JavaScript, removing XSS as a path to bypassing the second factor.
  set2faPendingCookie(res: Response, pendingId: string): void {
    const insecureDev = this.isInsecureDevEnvironment();
    const name = insecureDev ? '2fa_pending' : '__Host-2fa_pending';
    // INVARIANT: never pass `domain` here. In production the __Host- prefix enforces it; in dev
    // we rely on this call site omitting it, so the cookie can never widen to sibling subdomains.
    res.cookie(name, pendingId, {
      httpOnly: true,
      secure: !insecureDev,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // matches the server-side pending-session TTL
      path: '/api/v1/auth/verify-2fa',
    });
  }

  clear2faPendingCookie(res: Response): void {
    const insecureDev = this.isInsecureDevEnvironment();
    res.clearCookie('__Host-2fa_pending', { path: '/api/v1/auth/verify-2fa', secure: true });
    res.clearCookie('2fa_pending', { path: '/api/v1/auth/verify-2fa', secure: !insecureDev });
  }

  /**
   * Deliver the step-up token as an httpOnly cookie.
   *
   * It was previously returned in the response body and replayed by the client in an
   * `x-step-up-token` header, which handed JavaScript a credential capable of authorising 2FA
   * changes, impersonation, account deletion and session revocation — exactly the exposure the
   * cookie-only rule for access tokens exists to prevent.
   *
   * Path is '/' because the scopes it guards live under several routers (auth, users).
   * Confidentiality rests on httpOnly + the scope claim + single use, not on path scoping.
   */
  setStepUpCookie(res: Response, token: string, maxAgeMs: number): void {
    const insecureDev = this.isInsecureDevEnvironment();
    const name = insecureDev ? 'step_up' : '__Host-step_up';
    res.cookie(name, token, {
      httpOnly: true,
      secure: !insecureDev,
      sameSite: 'lax',
      maxAge: maxAgeMs,
      path: '/',
    });
  }

  clearStepUpCookie(res: Response): void {
    const insecureDev = this.isInsecureDevEnvironment();
    res.clearCookie('__Host-step_up', { path: '/', secure: true });
    res.clearCookie('step_up', { path: '/', secure: !insecureDev });
  }

  clearAuthCookies(res: Response): void {
    const insecureDev = this.isInsecureDevEnvironment();
    // Both prefixed and unprefixed names are cleared so a environment switch cannot strand a
    // stale cookie that would keep being replayed.
    res.clearCookie('__Host-access_token', { path: '/', secure: true });
    res.clearCookie('access_token', { path: '/', secure: !insecureDev });
    // H-10: the refresh cookie uses __Secure- rather than __Host- because it needs a narrowed
    // Path. INVARIANT: `domain` is never set on it — setAuthCookies above omits it — so it
    // cannot be read from a sibling subdomain.
    res.clearCookie('__Secure-refresh_token', { path: '/api/v1/auth/refresh', secure: true });
    res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh', secure: !insecureDev });
    res.clearCookie('XSRF-TOKEN', { path: '/' });
    this.clearStepUpCookie(res);
  }
}
