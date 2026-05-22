
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    // Skip Safe Methods (GET, HEAD, OPTIONS)
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    // Check custom header X-XSRF-TOKEN
    const xsrfToken = request.headers['x-xsrf-token'];

    // In a Double Submit Cookie pattern, the client reads the XSRF-TOKEN cookie
    // and sends it back in the X-XSRF-TOKEN header.
    // The server verifies that the cookie matches the header.

    // Note: Since cookies are not readable by JS if HttpOnly is true,
    // we must ensure the XSRF-TOKEN cookie is NOT HttpOnly.
    // The actual authentication session cookie IS HttpOnly.

    const xsrfCookie = request.cookies['XSRF-TOKEN'];

    if (!xsrfToken || !xsrfCookie || xsrfToken !== xsrfCookie) {
      this.logger.warn(`[SECURITY] CSRF Token Mismatch or Missing. Method: ${method}, URL: ${request.url}`);
      throw new ForbiddenException('Invalid CSRF Token');
    }

    return true;
  }
}
