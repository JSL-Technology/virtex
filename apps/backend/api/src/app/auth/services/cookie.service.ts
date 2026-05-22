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

    // 10/10 SECURITY: Strict Cookie Settings
    // We enforce HTTPOnly and Secure (in production).
    // SameSite=Lax is chosen over Strict to support OAuth redirection flows (Google/Microsoft),
    // which otherwise drop cookies on the callback POST/GET.
    // CSRF is handled separately via Double Submit Cookie (XSRF-TOKEN).
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax' as 'strict' | 'lax' | 'none',
      path: '/', // Explicitly set path to root to ensure availability across API and Sockets
    };

    // Access Token
    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      maxAge: AuthConfig.COOKIE_ACCESS_MAX_AGE,
    });

    // Refresh Token
    if (refreshToken) {
      res.cookie('refresh_token', refreshToken, {
        ...cookieOptions,
        maxAge: rememberMe
          ? AuthConfig.COOKIE_REFRESH_REMEMBER_ME_MAX_AGE
          : AuthConfig.COOKIE_REFRESH_MAX_AGE,
        path: '/api/v1/auth/refresh', // 10/10 SECURITY: Limit scope of refresh token
      });
    }

    this.setCsrfCookie(res);
  }

  setCsrfCookie(res: Response): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    // CSRF Token (Readable by JS, not HttpOnly)
    // 10/10 SECURITY: Use CSPRNG for CSRF token generation
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('XSRF-TOKEN', csrfToken, {
      secure: isProduction,
      sameSite: 'lax', // Must be readable on same site
      httpOnly: false, // Essential for JS to read and send back in header
      maxAge: AuthConfig.COOKIE_ACCESS_MAX_AGE,
      path: '/', // Explicitly set path to root so frontend can read it via document.cookie
    });
  }

  setRegisterTokenCookie(res: Response, token: string): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    res.cookie('register_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 15, // 15 minutes
      path: '/',
    });
  }

  clearAuthCookies(res: Response): void {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });
    res.clearCookie('XSRF-TOKEN', { path: '/' });
  }
}
