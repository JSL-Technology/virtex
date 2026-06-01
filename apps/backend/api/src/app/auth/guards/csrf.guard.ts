import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { AuthConfig } from '../auth.config';

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    const headerValue = request.headers['x-xsrf-token'] as string | undefined;
    const cookieValue = request.cookies['XSRF-TOKEN'] as string | undefined;

    // H-07 FIX: Validate signed double-submit CSRF token.
    // The cookie value set by CookieService is "nonce.HMAC-SHA256(secret,nonce)".
    // Both conditions must hold:
    //   1. Cookie == Header (double-submit pattern — prevents simple CSRF)
    //   2. HMAC is valid (defeats subdomain cookie fixation — attacker cannot forge
    //      a valid MAC without the server secret)
    // Reference: OWASP CSRF Prevention Cheat Sheet "Signed Double-Submit Cookie"; CWE-352.
    if (!headerValue || !cookieValue || headerValue !== cookieValue) {
      this.logger.warn(`[SECURITY] CSRF Token Mismatch or Missing. Method: ${method}, URL: ${request.url}`);
      throw new ForbiddenException('Invalid CSRF Token');
    }

    const dotIndex = headerValue.indexOf('.');
    if (dotIndex < 1) {
      this.logger.warn(`[SECURITY] CSRF Token malformed (no separator). URL: ${request.url}`);
      throw new ForbiddenException('Invalid CSRF Token');
    }

    const nonce = headerValue.slice(0, dotIndex);
    const receivedMac = headerValue.slice(dotIndex + 1);

    const expectedMac = crypto
      .createHmac('sha256', AuthConfig.CSRF_SECRET)
      .update(nonce)
      .digest('base64url');

    try {
      const expectedBuf = Buffer.from(expectedMac);
      const receivedBuf = Buffer.from(receivedMac);
      if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
        this.logger.warn(`[SECURITY] CSRF HMAC verification failed. URL: ${request.url}`);
        throw new ForbiddenException('Invalid CSRF Token');
      }
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      this.logger.warn(`[SECURITY] CSRF HMAC comparison error. URL: ${request.url}`);
      throw new ForbiddenException('Invalid CSRF Token');
    }

    return true;
  }
}
