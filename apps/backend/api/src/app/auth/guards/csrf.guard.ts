import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { HttpRequest as Request } from '../../common/http/http.types';
import { CookieService } from '../services/cookie.service';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';
import { ForbiddenError } from '../../i18n/localized.exception';

/**
 * Signed double-submit CSRF validation, applied to every state-changing request.
 *
 * Registered as an APP_GUARD. It used to be declared per-endpoint, and the result was what
 * per-endpoint security controls always become: of the fifty controllers with a POST, PATCH, PUT
 * or DELETE, four had it. Journal entries, invoices, reconciliations and period closes did not.
 *
 * `SameSite=Lax` on the session cookie blocks the classic cross-site form post, which is why this
 * was survivable — but Lax is same-SITE, not same-ORIGIN: a compromised sibling subdomain is
 * same-site, and its requests carry the session cookie. The `__Host-` prefix stops such a
 * subdomain from *writing* the cookie; it does nothing to stop it from *sending* one. This guard
 * is the control that covers that case, and it only works if it is on by default.
 *
 * The XSRF-TOKEN cookie holds `nonce.binding.HMAC(secret, nonce:binding)`. The guard re-computes
 * the HMAC — so a token injected by a sibling subdomain fails, because the attacker cannot forge
 * a signature — and, when the request carries an authenticated principal, checks that the token
 * was minted for that same principal, so a token obtained from the attacker's own account cannot
 * be replayed against a victim's session.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  /** Methods that must not change state, and therefore need no token (RFC 9110 §9.2.1). */
  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

  constructor(
    private readonly cookieService: CookieService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Non-HTTP contexts (WebSocket handshakes, scheduled jobs) have no cookies to double-submit;
    // they authenticate through their own path.
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: { id?: string } }>();
    const method = request.method;

    if (CsrfGuard.SAFE_METHODS.has(method)) {
      return true;
    }

    const exempt = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) {
      return true;
    }

    // CSRF is an attack on AMBIENT authority: the browser attaches a credential the user did not
    // choose to send. A request that carries no such credential — sign-in, sign-up, a password
    // reset redeemed with a one-time token — has nothing for an attacker to ride, and demanding a
    // token there would be impossible anyway, because a visitor who has never authenticated has
    // never been issued one.
    //
    // So the rule is: enforce wherever the request carries a session. That covers every
    // authenticated route, plus `refresh` and `verify-2fa`, which carry their own cookies and are
    // exactly the unauthenticated endpoints that DO hold ambient authority.
    if (!request.user?.id && !CsrfGuard.carriesSessionCookie(request)) {
      return true;
    }

    const tokenFromHeader = request.headers['x-xsrf-token'] as string | undefined;
    // Read through CookieService: the name depends on the environment and has a `__Host-` prefix
    // in every deployment, so a literal here is how the two sides drift apart.
    const tokenFromCookie = this.cookieService.readCsrfToken(
      request.cookies as Record<string, string | undefined> | undefined,
    );

    if (!tokenFromHeader || !tokenFromCookie || tokenFromHeader !== tokenFromCookie) {
      this.logger.warn(
        { event: 'csrf_mismatch', method, url: request.url },
        '[SECURITY] CSRF token header/cookie mismatch',
      );
      throw new ForbiddenError('AUTH.INVALID_CSRF_TOKEN');
    }

    // The global JwtAuthGuard runs before this one, so on authenticated routes `request.user` is
    // already populated. On @Public() routes (login, refresh) it is absent and the token's `anon`
    // binding is accepted.
    const currentUserId = request.user?.id;

    if (!this.cookieService.verifyCsrfToken(tokenFromHeader, currentUserId)) {
      this.logger.warn(
        { event: 'csrf_invalid', method, url: request.url, bound: Boolean(currentUserId) },
        '[SECURITY] CSRF token signature or binding invalid',
      );
      throw new ForbiddenError('AUTH.INVALID_CSRF_TOKEN');
    }

    return true;
  }

  /**
   * True when the request arrives with a cookie that confers authority on its own.
   *
   * Both the prefixed and unprefixed names are checked: the prefixed forms are what production
   * issues, the bare ones exist only in local plain-HTTP development where browsers reject
   * `Secure`. Missing one here would silently disable the check in whichever environment used it.
   */
  private static carriesSessionCookie(request: Request): boolean {
    const cookies = (request.cookies ?? {}) as Record<string, string | undefined>;
    return [
      '__Host-access_token',
      'access_token',
      '__Secure-refresh_token',
      'refresh_token',
      '__Secure-2fa_pending',
      '2fa_pending',
      '__Host-2fa_pending',
    ].some((name) => Boolean(cookies[name]));
  }
}
