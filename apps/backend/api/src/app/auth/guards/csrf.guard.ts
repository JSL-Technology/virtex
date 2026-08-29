import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { CookieService } from '../services/cookie.service';

/**
 * Signed double-submit CSRF validation.
 *
 * The XSRF-TOKEN cookie holds `nonce.binding.HMAC(secret, nonce:binding)`. The guard
 * re-computes the HMAC (defeating cookie injection from a sibling subdomain, since the attacker
 * cannot forge a signature) and — when the request carries an authenticated principal — checks
 * that the token was minted for that same principal, so a token obtained from the attacker's own
 * account cannot be replayed against a victim's session.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  constructor(private readonly cookieService: CookieService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: { id?: string } }>();
    const method = request.method;

    // Safe methods must not mutate state, so they need no CSRF token.
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const tokenFromHeader = request.headers['x-xsrf-token'] as string | undefined;
    const tokenFromCookie = request.cookies?.['XSRF-TOKEN'] as string | undefined;

    if (!tokenFromHeader || !tokenFromCookie || tokenFromHeader !== tokenFromCookie) {
      this.logger.warn(
        { event: 'csrf_mismatch', method, url: request.url },
        '[SECURITY] CSRF token header/cookie mismatch',
      );
      throw new ForbiddenException('Invalid CSRF Token');
    }

    // The global JwtAuthGuard runs before controller-scoped guards, so on authenticated routes
    // `request.user` is already populated here. On @Public() routes (login, refresh) it is
    // absent and the token's `anon` binding is accepted.
    const currentUserId = request.user?.id;

    if (!this.cookieService.verifyCsrfToken(tokenFromHeader, currentUserId)) {
      this.logger.warn(
        { event: 'csrf_invalid', method, url: request.url, bound: Boolean(currentUserId) },
        '[SECURITY] CSRF token signature or binding invalid',
      );
      throw new ForbiddenException('Invalid CSRF Token');
    }

    return true;
  }
}
