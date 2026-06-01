import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthConfig } from '../auth.config';
import * as crypto from 'crypto';

@Injectable()
export class CookieService {
  constructor(private readonly configService: ConfigService) {}

  setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string | null,
    rememberMe: boolean = false
  ): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';

    // H-15 FIX: In development (HTTP), __Host- / __Secure- prefixes require Secure=true,
    // which browsers reject over plain HTTP, breaking local auth.
    // Use prefixed names only in production (HTTPS) and fall back to unprefixed names
    // with Secure=false for local dev (RFC 6265bis; OWASP Session Management Cheat Sheet).
    const accessTokenName = isProduction ? '__Host-access_token' : 'access_token';
    const refreshTokenName = isProduction ? '__Secure-refresh_token' : 'refresh_token';

    const baseOptions = {
      httpOnly: true,
      secure: isProduction,
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
        path: '/api/v1/auth/refresh',
      });
    }

    this.setCsrfCookie(res);
  }

  setCsrfCookie(res: Response): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';

    // H-07 FIX: Signed double-submit CSRF cookie.
    // Format: base64url(nonce).base64url(HMAC-SHA256(secret, nonce))
    // Even if an attacker can fixate a cookie from a compromised subdomain they cannot
    // forge a valid HMAC without the server secret (OWASP CSRF Prevention Cheat Sheet
    // "Signed Double-Submit Cookie"; CWE-352).
    const nonce = crypto.randomBytes(32).toString('base64url');
    const mac = crypto.createHmac('sha256', AuthConfig.CSRF_SECRET).update(nonce).digest('base64url');
    const csrfToken = `${nonce}.${mac}`;

    res.cookie('XSRF-TOKEN', csrfToken, {
      secure: isProduction,
      sameSite: 'lax',
      httpOnly: false, // Must be readable by JS so the client can send it in X-XSRF-TOKEN header
      maxAge: AuthConfig.COOKIE_ACCESS_MAX_AGE,
      path: '/',
    });
  }

  setSocialRegisterTokenCookie(res: Response, token: string): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    // H-12 FIX: Apply the same env-aware strategy as setAuthCookies.
    // Browsers reject Secure cookies over plain HTTP, breaking social registration
    // in local dev. Only use __Host- prefix and Secure=true in production.
    // (RFC 6265bis cookie prefixes; OWASP Session Management Cheat Sheet)
    const name = isProduction ? '__Host-social_register_token' : 'social_register_token';
    res.cookie(name, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
      path: '/',
    });
  }

  setRegisterTokenCookie(res: Response, token: string): void {
    res.cookie('__Host-register_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 15, // 15 minutes
      path: '/',
    });
  }

  // H-03 FIX: 2FA pending session delivered as an httpOnly cookie so the token
  // never touches JavaScript memory, eliminating XSS-based token theft (OWASP MFA Cheat Sheet;
  // OWASP ASVS 2.8/3.4; CWE-922).
  set2faPendingCookie(res: Response, pendingId: string): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const name = isProduction ? '__Host-2fa_pending' : '2fa_pending';
    // H-10 NOTE: Never pass `domain` to this cookie — __Host- prefix enforces it in
    // production; in dev we rely on the invariant that no domain option is added here.
    res.cookie(name, pendingId, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // 5 minutes — matches server-side pending session TTL
      path: '/api/v1/auth/verify-2fa',
    });
  }

  clear2faPendingCookie(res: Response): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    res.clearCookie('__Host-2fa_pending', { path: '/api/v1/auth/verify-2fa', secure: true });
    res.clearCookie('2fa_pending', { path: '/api/v1/auth/verify-2fa', secure: isProduction });
  }

  clearAuthCookies(res: Response): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    res.clearCookie('__Host-access_token', { path: '/', secure: true });
    res.clearCookie('access_token', { path: '/', secure: isProduction });
    // H-10 FIX: Refresh cookie uses __Secure- (not __Host-) to allow path restriction.
    // INVARIANT: domain must never be set on the refresh cookie. If a domain attribute were
    // added it would allow subdomain access. This clearCookie call intentionally omits
    // domain to enforce that invariant — any domain value would have to be set at creation
    // time, and setAuthCookies above never passes domain.
    res.clearCookie('__Secure-refresh_token', { path: '/api/v1/auth/refresh', secure: true });
    res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh', secure: isProduction });
    res.clearCookie('XSRF-TOKEN', { path: '/' });
  }
}
