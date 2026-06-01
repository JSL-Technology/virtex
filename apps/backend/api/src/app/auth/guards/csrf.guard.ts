
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { CookieService } from '../services/cookie.service';

// H10 FIX: Signed double-submit CSRF validation.
// The cookie contains nonce.HMAC(secret, nonce). The guard recomputes the HMAC and compares
// with timing-safe equality, preventing subdomain cookie injection attacks.
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  constructor(private readonly cookieService: CookieService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    // Skip Safe Methods (GET, HEAD, OPTIONS)
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const tokenFromHeader = request.headers['x-xsrf-token'] as string | undefined;
    const tokenFromCookie = request.cookies['XSRF-TOKEN'] as string | undefined;

    if (!tokenFromHeader || !tokenFromCookie || tokenFromHeader !== tokenFromCookie) {
      this.logger.warn({ event: 'csrf_mismatch', method, url: request.url }, '[SECURITY] CSRF token header/cookie mismatch');
      throw new ForbiddenException('Invalid CSRF Token');
    }

    if (!this.cookieService.verifyCsrfToken(tokenFromHeader)) {
      this.logger.warn({ event: 'csrf_invalid_signature', method, url: request.url }, '[SECURITY] CSRF token signature invalid');
      throw new ForbiddenException('Invalid CSRF Token');
    }

    return true;
  }
}
