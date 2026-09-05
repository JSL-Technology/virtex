import { Controller, Post, Get, Body, UseGuards, Res } from '@nestjs/common';
import type { HttpResponse as Response } from '../common/http/http.types';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { AuthService } from './auth.service';
import { AuthFacade } from './auth.facade';
import { WebAuthnService } from './services/webauthn.service';
import { CookieService } from './services/cookie.service';
import { JwtAuthGuard } from './guards/jwt/jwt.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { StepUpGuard } from './guards/step-up.guard';
import { StepUp } from './decorators/step-up.decorator';
import { StepUpScope } from './enums/step-up-scope.enum';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { AuthConfig } from './auth.config';
import { UserResponseDto } from './dto/user-response.dto';
import { VerifyWebAuthnAuthDto } from './dto/verify-webauthn-auth.dto';
import { VerifyWebAuthnRegistrationDto } from './dto/security-audit.dto';
import { WebAuthnLoginOptionsDto } from './dto/auth-payloads.dto';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';

/**
 * WebAuthn / passkeys (FIDO2). Split out of `AuthController`; every route keeps its exact guards.
 *
 * Registration is a critical MFA mutation (CSRF + step-up), while the login handshake is public and
 * rate-limited to blunt credential-enumeration and oracle abuse. `@AllowInactiveSubscription`
 * because authenticating is never gated on billing.
 */
@ApiTags('Auth')
@AllowInactiveSubscription()
@Controller('auth')
export class AuthWebAuthnController {
  constructor(
    private readonly authService: AuthService,
    private readonly authFacade: AuthFacade,
    private readonly webAuthnService: WebAuthnService,
    private readonly cookieService: CookieService,
  ) {}

  @Get('webauthn/register/options')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate WebAuthn registration options' })
  async generateWebAuthnRegistrationOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.webAuthnService.generateRegistrationOptions(user);
  }

  // H3 FIX: WebAuthn credential binding is a critical MFA mutation; requires CSRF + step-up 2FA.
  @Post('webauthn/register/verify')
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.REGISTER_PASSKEY)
  @ApiOperation({ summary: 'Verify WebAuthn registration' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyWebAuthnRegistration(@CurrentUser() user: AuthenticatedUser, @Body() body: VerifyWebAuthnRegistrationDto) {
    return this.webAuthnService.verifyRegistration(user, body);
  }

  // H10 FIX: WebAuthn challenge generation must be rate-limited to prevent oracle/enumeration abuse.
  @Public()
  @Post('webauthn/login/options')
  @ApiOperation({ summary: 'Generate WebAuthn authentication options' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async generateWebAuthnAuthenticationOptions(@Body() dto: WebAuthnLoginOptionsDto) {
    return this.webAuthnService.generateAuthenticationOptions(dto.email);
  }

  @Public()
  @Post('webauthn/login/verify')
  @ApiOperation({ summary: 'Verify WebAuthn authentication' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  @UseGuards(CsrfGuard)
  async verifyWebAuthnAuthentication(
    @Body() body: VerifyWebAuthnAuthDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.webAuthnService.verifyAuthentication(body);
    const user = result.user;

    // FIDO2/WebAuthn is inherently multi-factor (possession + biometric/PIN = NIST AAL2).
    // However, if the user has explicitly configured TOTP or SMS 2FA, we honour that
    // organisational policy by requiring the second factor before issuing session cookies.
    if (user.security?.isTwoFactorEnabled) {
      // H-03 FIX: Same cookie-based pending session as the password login flow.
      const pendingId = await this.authService.create2faPendingSession(user, undefined, undefined);
      this.cookieService.set2faPendingCookie(res, pendingId);
      return { require2fa: true, messageKey: 'AUTH.2FA_VERIFICATION_REQUIRED' };
    }

    const { accessToken, refreshToken } = await this.authFacade.generateTokens(user);
    this.cookieService.setAuthCookies(res, accessToken, refreshToken, { userId: user.id });

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      // accessToken OMITTED — available exclusively via the __Host-access_token cookie (CWE-200)
    };
  }
}
