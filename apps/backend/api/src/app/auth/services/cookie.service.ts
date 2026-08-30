import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HttpResponse as Response } from '../../common/http/http.types';
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

  /**
   * Absolute path of an API route, derived from the same `API_PREFIX` the application registers
   * with `setGlobalPrefix`.
   *
   * Path-scoped cookies used to hardcode `/api/v1/...`. Changing `API_PREFIX` therefore did not
   * move the cookie with the route: the browser stopped sending it and the session broke with no
   * error anywhere. Deriving the path from the same source removes the possibility.
   */
  private apiPath(route: string): string {
    const prefix = this.configService.get<string>('API_PREFIX', 'api/v1').replace(/^\/|\/$/g, '');
    return `/${prefix}/${route.replace(/^\//, '')}`;
  }

  /**
   * Pick a cookie name and path that are actually accepted by the browser.
   *
   * The `__Host-` prefix is the strongest binding available — it forces `Secure`, forbids
   * `Domain`, and pins `Path=/`, so a sibling subdomain can neither read nor overwrite the
   * cookie (RFC 6265bis §4.1.3.2). The catch is that all three conditions are mandatory: a
   * `__Host-` cookie with any path other than `/` is silently discarded.
   *
   * That is exactly what happened to the pending-2FA cookie. It was issued as
   * `__Host-2fa_pending` with `Path=/api/v1/auth/verify-2fa`, so in production the browser threw
   * it away, `POST /auth/verify-2fa` found no cookie, and every account with a second factor was
   * locked out. Local development hid the bug completely, because there the name carries no
   * prefix.
   *
   * So a path-scoped cookie takes the `__Secure-` prefix instead, which mandates `Secure` and
   * forbids nothing else. It is a genuine step down in strength — `__Secure-` does not stop a
   * sibling subdomain from setting the cookie — which is why the value it carries is a random
   * server-side session id that is useless without the matching cache entry, and why the entry
   * is additionally bound to the client's IP and User-Agent.
   */
  private scopedCookie(baseName: string, route: string): { name: string; path: string } {
    const insecureDev = this.isInsecureDevEnvironment();
    return {
      name: insecureDev ? baseName : `__Secure-${baseName}`,
      path: this.apiPath(route),
    };
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
    const refresh = this.scopedCookie('refresh_token', 'auth/refresh');

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
      res.cookie(refresh.name, refreshToken, {
        ...baseOptions,
        maxAge: rememberMe
          ? AuthConfig.COOKIE_REFRESH_REMEMBER_ME_MAX_AGE
          : AuthConfig.COOKIE_REFRESH_MAX_AGE,
        // Path-scoped so the long-lived refresh token is not attached to every API call.
        path: refresh.path,
      });
    }

    this.setCsrfCookie(res, userId);
  }

  /**
   * Names the CSRF cookie has been issued under, most-secure first.
   *
   * `__Host-` does NOT stop JavaScript from reading a cookie — it forces `Secure`, forbids
   * `Domain`, and pins `Path=/`. That is exactly the protection this cookie needs and did not
   * have: without the prefix a compromised sibling subdomain can OVERWRITE it, which is the
   * scenario `CsrfGuard`'s own comment says the signed double-submit exists to cover. The HMAC
   * signature blocks a forged value, but an attacker does not need to forge one — they can obtain
   * a validly signed `anon` token simply by calling `POST /auth/login`, then plant it and send the
   * matching header. On authenticated routes the user binding still rejects it; on `POST
   * /auth/refresh`, which has no authenticated principal, an `anon` token is accepted by design.
   */
  private csrfCookieNames(): string[] {
    return ['__Host-XSRF-TOKEN', 'XSRF-TOKEN'];
  }

  /** The name this environment writes. Prefixed everywhere except plain-HTTP local development. */
  csrfCookieName(): string {
    return this.isInsecureDevEnvironment() ? 'XSRF-TOKEN' : '__Host-XSRF-TOKEN';
  }

  /** Read the CSRF token under whichever name it was issued. */
  readCsrfToken(cookies: Record<string, string | undefined> | undefined): string | undefined {
    if (!cookies) return undefined;
    for (const name of this.csrfCookieNames()) {
      if (cookies[name]) return cookies[name];
    }
    return undefined;
  }

  setCsrfCookie(res: Response, userId?: string): void {
    const csrfToken = this.generateSignedCsrfToken(userId);
    res.cookie(this.csrfCookieName(), csrfToken, {
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

  /**
   * Names the registration transaction cookie has been issued under, most-secure first.
   * Both are read so a dev/prod switch cannot strand a checkout in flight.
   */
  private registrationTransactionCookieNames(): string[] {
    return ['__Secure-reg_txn', 'reg_txn'];
  }

  /**
   * Bind a pending registration to the browser that started its checkout.
   *
   * `POST /auth/register-confirm` is necessarily public — the account does not exist yet — and it
   * used to accept a Stripe `session_id` from the request body as its ONLY input, then mint full
   * session cookies for the tenant owner. That made the checkout session id a bearer credential
   * for the account, and Stripe returns it to the browser in the success URL's query string:
   * browser history, the `Referer` sent to any third-party resource on that page, and every proxy
   * access log along the way. Worse, it never expired as one, because
   * `completePendingRegistration` returns the existing user once the account is created, so the
   * same id kept minting sessions indefinitely.
   *
   * The proof is now possession of this cookie, which is httpOnly, `SameSite=Lax` so it survives
   * the return redirect from Stripe, scoped to the confirm route, and never leaves the browser
   * that began the signup. Knowing the session id is no longer sufficient.
   */
  setRegistrationTransactionCookie(res: Response, pendingRegistrationId: string, maxAgeMs: number): void {
    const insecureDev = this.isInsecureDevEnvironment();
    const { name, path } = this.scopedCookie('reg_txn', 'auth/register-confirm');
    res.cookie(name, pendingRegistrationId, {
      httpOnly: true,
      secure: !insecureDev,
      // Lax, not Strict: Stripe redirects the browser back to us cross-site, and a Strict cookie
      // would not be attached to the navigation that follows.
      sameSite: 'lax',
      maxAge: maxAgeMs,
      path,
    });
  }

  /** The pending-registration id this browser started, if it started one. */
  readRegistrationTransactionId(
    cookies: Record<string, string | undefined> | undefined,
  ): string | undefined {
    if (!cookies) return undefined;
    for (const name of this.registrationTransactionCookieNames()) {
      if (cookies[name]) return cookies[name];
    }
    return undefined;
  }

  clearRegistrationTransactionCookie(res: Response): void {
    const insecureDev = this.isInsecureDevEnvironment();
    const path = this.apiPath('auth/register-confirm');
    for (const name of this.registrationTransactionCookieNames()) {
      res.clearCookie(name, { path, secure: name.startsWith('__') || !insecureDev });
    }
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
    const { name, path } = this.scopedCookie('2fa_pending', 'auth/verify-2fa');
    // INVARIANT: never pass `domain` here, so the cookie cannot widen to sibling subdomains.
    res.cookie(name, pendingId, {
      httpOnly: true,
      secure: !insecureDev,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // matches the server-side pending-session TTL
      path,
    });
  }

  /** Every name this cookie has ever been issued under, so a rename cannot strand a live one. */
  private twoFactorPendingCookieNames(): string[] {
    return ['__Secure-2fa_pending', '2fa_pending', '__Host-2fa_pending'];
  }

  /** Read the pending-2FA session id, accepting any name the cookie has been issued under. */
  read2faPendingId(cookies: Record<string, string | undefined> | undefined): string | undefined {
    if (!cookies) return undefined;
    for (const name of this.twoFactorPendingCookieNames()) {
      if (cookies[name]) return cookies[name];
    }
    return undefined;
  }

  clear2faPendingCookie(res: Response): void {
    const insecureDev = this.isInsecureDevEnvironment();
    const path = this.apiPath('auth/verify-2fa');
    // `__Host-2fa_pending` is cleared too: it was issued under that name before the prefix bug
    // was fixed. Browsers discarded it, but a proxy or an older client may still present one.
    for (const name of this.twoFactorPendingCookieNames()) {
      res.clearCookie(name, { path, secure: name.startsWith('__') || !insecureDev });
    }
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
    const refreshPath = this.apiPath('auth/refresh');
    res.clearCookie('__Secure-refresh_token', { path: refreshPath, secure: true });
    res.clearCookie('refresh_token', { path: refreshPath, secure: !insecureDev });
    for (const name of this.csrfCookieNames()) {
      res.clearCookie(name, { path: '/', secure: name.startsWith('__') || !insecureDev });
    }
    this.clearStepUpCookie(res);
  }
}
