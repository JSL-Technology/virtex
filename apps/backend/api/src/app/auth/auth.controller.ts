
import { Controller, Post, Body, HttpCode, HttpStatus, Res, Get, UseGuards, Req, UsePipes, ValidationPipe, BadRequestException, UnauthorizedException, Param, Ip, Headers, UseFilters, Header } from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { AuthFacade } from './auth.facade';
import { TwoFactorAuthService } from './services/two-factor-auth.service';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { WebAuthnService } from './services/webauthn.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RequestWithUser } from './interfaces/request-with-user.interface';
import { SocialUser } from './interfaces/social-user.interface';
import { RegisterUserDto } from './dto/register-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { JwtAuthGuard } from './guards/jwt/jwt.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { SocialUserDecorator } from './decorators/social-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { Throttle } from '@nestjs/throttler';
import { GoogleRecaptchaGuard } from '@nestlab/google-recaptcha';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyWebAuthnAuthDto } from './dto/verify-webauthn-auth.dto';
import {
  Verify2faDto,
  SendPublicVerificationDto,
  VerifyPublicCodeDto,
  CreateCheckoutSessionDto,
  VerifyWebAuthnRegistrationDto
} from './dto/security-audit.dto';

import { SetPasswordFromInvitationDto } from './dto/set-password-from-invitation.dto';
import { VerificationType } from './entities/verification-code.entity';
import { PaymentService } from '../payment/payment.service';
import { SaasService } from '../saas/saas.service';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from './auth.config';
import { TypeOrmExceptionFilter } from '../common/filters/typeorm-exception.filter';
import { CookieService } from './services/cookie.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { LoginResponseDto } from './dto/responses/login-response.dto';
import { plainToInstance } from 'class-transformer';
import { AuthGuard } from '@nestjs/passport';
import { EnableTwoFactorDto } from './dto/enable-2fa.dto';
import { CsrfGuard } from './guards/csrf.guard';
import { PermissionsGuard } from './guards/permissions/permissions.guard';
import { HasPermission } from './decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { MfaOrchestratorService } from './services/mfa-orchestrator.service';
import { JwtService } from '@nestjs/jwt';
import { TwoFactorVerifiedGuard } from './guards/two-factor-verified.guard';
import { Public } from './decorators/public.decorator';

@ApiTags('Auth')
@Controller('auth')
@UseFilters(TypeOrmExceptionFilter)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authFacade: AuthFacade,
    private readonly twoFactorAuthService: TwoFactorAuthService,
    private readonly passwordRecoveryService: PasswordRecoveryService,
    private readonly webAuthnService: WebAuthnService,
    private readonly configService: ConfigService,
    private readonly cookieService: CookieService,
    private readonly mfaOrchestratorService: MfaOrchestratorService,
    private readonly jwtService: JwtService,
    private readonly paymentService: PaymentService,
    private readonly saasService: SaasService
  ) {}

  @Get('google')
  @Public()
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req: Request) {}

  @Get('google/callback')
  @Public()
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@SocialUserDecorator() socialUser: SocialUser, @Res() res: Response) {
      await this.handleSocialCallback(socialUser, res);
  }

  @Get('microsoft')
  @Public()
  @UseGuards(AuthGuard('microsoft'))
  async microsoftAuth(@Req() req: Request) {}

  @Get('microsoft/callback')
  @Public()
  @UseGuards(AuthGuard('microsoft'))
  async microsoftAuthRedirect(@SocialUserDecorator() socialUser: SocialUser, @Res() res: Response) {
      await this.handleSocialCallback(socialUser, res);
  }

  @Get('okta')
  @Public()
  @UseGuards(AuthGuard('okta'))
  async oktaAuth(@Req() req: Request) {}

  @Get('okta/callback')
  @Public()
  @UseGuards(AuthGuard('okta'))
  async oktaAuthRedirect(@SocialUserDecorator() socialUser: SocialUser, @Res() res: Response) {
      await this.handleSocialCallback(socialUser, res);
  }

  private async handleSocialCallback(socialUser: SocialUser, res: Response) {
    const { user, tokens } = await this.authFacade.socialLogin(socialUser);
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');

    if (!user) {
        // Generate a secure, short-lived token to transfer PII safely
        const registerToken = await this.authFacade.generateRegisterToken(socialUser);

        // Use centralised CookieService to avoid inline options drifting out of sync.
        this.cookieService.setSocialRegisterTokenCookie(res, registerToken);

        // Redirect without token in URL
        return res.redirect(`${frontendUrl}/auth/register?social_registration=true`);
    }

    // Login successful
    this.cookieService.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res.redirect(`${frontendUrl}/dashboard`);
  }

  @Get('social-register-info')
  @Public()
  @ApiOperation({ summary: 'Decode social register token to pre-fill form' })
  async getSocialRegisterInfo(@Req() req: Request) {
      const tokenToUse = req.cookies['social_register_token'] || req.cookies['__Host-social_register_token'];

      if (!tokenToUse) {
          throw new BadRequestException('Token de registro no encontrado (cookie requerida)');
      }
      return this.authFacade.getSocialRegisterInfo(tokenToUse);
  }

  @Post('register')
  @Public()
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Register a new user and organization' })
  @ApiResponse({ status: 201, description: 'User successfully registered.', type: AuthResponseDto })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async register(
    @Body() registerUserDto: RegisterUserDto,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string
  ): Promise<AuthResponseDto> {
    const { user, accessToken, refreshToken } =
      await this.authFacade.register(registerUserDto, ip, userAgent);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      // 10/10 SECURITY: DO NOT return accessToken in body if using cookies.
      // JS doesn't need it and it increases XSS surface.
    } as any;
  }

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful', type: AuthResponseDto })
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL },
  })
  @UseGuards(GoogleRecaptchaGuard)
  async login(
    @Body() loginUserDto: LoginUserDto,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(loginUserDto, ip, userAgent);

    // Check if 2FA is required
    if ('require2fa' in result && result.require2fa) {
        this.cookieService.setCsrfCookie(res);
        return result;
    }

    // Narrowing type
    if (!('accessToken' in result)) {
        throw new Error('Unexpected login result');
    }

    const { user, accessToken, refreshToken } = result;
    const rememberMe = loginUserDto.rememberMe || false;

    this.cookieService.setAuthCookies(res, accessToken, refreshToken, rememberMe);

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      // accessToken omitted for browser security
    } as any;
  }

  @Post('set-password-from-invitation')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: AuthResponseDto })
  // No CsrfGuard — the invitationToken is proof-of-possession (SHA-256, 32 bytes).
  // New users have never logged in and therefore have no XSRF-TOKEN cookie.
  async setPasswordFromInvitation(
    @Body() setPasswordDto: SetPasswordFromInvitationDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const { user, accessToken, refreshToken } =
      await this.authFacade.setPasswordFromInvitation(setPasswordDto);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      // accessToken OMITTED — available exclusively via __Host-access_token cookie (CWE-200)
    };
  }

  @Get('invitation/:token')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getInvitationDetails(@Param('token') token: string) {
    return this.passwordRecoveryService.getInvitationDetails(token);
  }

  @Post('refresh')
  @Public()
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: AuthResponseDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string
  ): Promise<AuthResponseDto> {
    const refreshToken = req.cookies?.['__Secure-refresh_token'] || req.cookies?.refresh_token;
    if (!refreshToken) {
      throw new BadRequestException('Refresh token no encontrado en cookies');
    }

    const result = await this.authService.refreshAccessToken(refreshToken, ip, userAgent);

    this.cookieService.setAuthCookies(res, result.accessToken, result.refreshToken);

    return {
      user: plainToInstance(UserResponseDto, result.user, { excludeExtraneousValues: true })
      // accessToken omitted for browser security
    } as any;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async logout(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.id);
    this.cookieService.clearAuthCookies(res);
    return { message: 'Logout exitoso' };
  }

  @Get('status')
  @Public()
  @Header('Cache-Control', 'no-store')
  async checkAuthStatus(@Req() req: Request) {
    const token = req.cookies['__Host-access_token'] || req.cookies['access_token'];

    if (!token) {
      return { isAuthenticated: false, user: null };
    }

    const user = await this.authService.verifyUserFromToken(token);

    if (!user) {
      return { isAuthenticated: false, user: null };
    }

    const statusResponse = await this.authService.status({
      id: user.id,
      isImpersonating: false,
    });

    return {
      isAuthenticated: true,
      user: plainToInstance(UserResponseDto, statusResponse.user, { excludeExtraneousValues: true }),
    };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(GoogleRecaptchaGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  @UsePipes(new ValidationPipe())
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    await this.passwordRecoveryService.sendPasswordResetLink(forgotPasswordDto);
    return {
      message:
        'Si existe una cuenta con ese correo, se ha enviado un enlace para restablecer la contraseña.',
    };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe())
  // No CsrfGuard — the reset token (SHA-256 of 32 random bytes) is proof-of-possession.
  // Users performing a password reset typically have no active session and therefore
  // no XSRF-TOKEN cookie. OWASP explicitly exempts endpoints already protected by
  // a one-time secret from requiring additional CSRF protection.
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    const user = await this.passwordRecoveryService.resetPassword(resetPasswordDto);
    // Return only whitelisted fields — never expose security entity (passwordHash,
    // twoFactorSecret, backupCodes, etc.) regardless of what the ORM loaded.
    return plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true });
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard, CsrfGuard, TwoFactorVerifiedGuard)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe())
  @ApiOperation({ summary: 'Change password for authenticated user' })
  async changePassword(
      @CurrentUser() user: User,
      @Body() changePasswordDto: ChangePasswordDto
  ) {
      await this.authService.changePassword(user.id, changePasswordDto.currentPassword, changePasswordDto.newPassword);
      return { message: 'Password updated successfully' };
  }

  @Post('impersonate')
  @UseGuards(JwtAuthGuard, CsrfGuard, PermissionsGuard)
  @HasPermission(PERMISSIONS.USERS_IMPERSONATE)
  async impersonate(
    @CurrentUser() adminUser: User,
    @Body('userId') targetUserId: string,
    @Res({ passthrough: true }) res: Response
  ) {
    const { user, accessToken, refreshToken } =
      await this.authFacade.impersonate(adminUser, targetUserId);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    // H-06 FIX: Never expose access_token in the response body.
    // All token delivery is cookie-only to prevent XSS token exfiltration
    // (OWASP ASVS 3.4.3; CWE-200).
    return { user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }) };
  }

  @Post('stop-impersonation')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async stopImpersonation(
    @CurrentUser() impersonatingUser: User,
    @Res({ passthrough: true }) res: Response
  ) {
    const { user, accessToken, refreshToken } =
      await this.authFacade.stopImpersonation(impersonatingUser);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    // H-06 FIX: Never expose access_token in the response body (OWASP ASVS 3.4.3; CWE-200).
    return { user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }) };
  }

  // ------------------------------------------------------------------
  // Two-Factor Authentication (MFA)
  // ------------------------------------------------------------------

  @Post('2fa/generate')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Generate 2FA secret and QR code URL' })
  async generateTwoFactorSecret(@CurrentUser() user: User) {
    return this.twoFactorAuthService.generateTwoFactorSecret(user);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Verify token and enable 2FA — requires current password as step-up' })
  async enableTwoFactor(
    @CurrentUser() user: User,
    @Body() enableTwoFactorDto: EnableTwoFactorDto,
  ) {
    // H-05 FIX: Pass currentPassword for step-up verification inside the service
    return this.twoFactorAuthService.enableTwoFactor(user, enableTwoFactorDto.token, enableTwoFactorDto.currentPassword);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard, CsrfGuard, TwoFactorVerifiedGuard)
  @ApiOperation({ summary: 'Disable 2FA' })
  async disableTwoFactor(@CurrentUser() user: User) {
    return this.twoFactorAuthService.disableTwoFactor(user);
  }

  @Post('2fa/backup-codes/generate')
  @UseGuards(JwtAuthGuard, CsrfGuard, TwoFactorVerifiedGuard)
  @ApiOperation({ summary: 'Generate new backup codes' })
  async generateBackupCodes(@CurrentUser() user: User) {
    return this.twoFactorAuthService.generateBackupCodes(user);
  }

  @Post('2fa/send-email-verification')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Send email verification code for 2FA setup' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async sendEmailVerification(@CurrentUser() user: User) {
    await this.mfaOrchestratorService.sendEmailOtp(user.id, user.email);
    return { message: 'Verification code sent to email' };
  }

  @Post('2fa/verify-email-verification')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Verify email code for 2FA setup' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyEmailVerification(@CurrentUser() user: User, @Body('code') code: string) {
    return this.mfaOrchestratorService.verifyEmailOtp(user.id, code);
  }

  @Post('send-phone-otp')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async sendPhoneOtp(@CurrentUser() user: User, @Body('phoneNumber') phoneNumber: string) {
      if (!phoneNumber) {
          throw new BadRequestException('Phone number is required');
      }

      // Validate E.164 format to prevent SMS abuse with malformed numbers
      const e164Regex = /^\+[1-9]\d{6,14}$/;
      if (!e164Regex.test(phoneNumber)) {
          throw new BadRequestException('Phone number must be in E.164 format (e.g. +18091234567)');
      }

      // Prevent SMS bombing: if the user already has a verified phone registered,
      // only allow sending OTP to that same number or to a new unverified one.
      // Sending to an arbitrary third-party number is not permitted.
      if (user.isPhoneVerified && user.phone && user.phone !== phoneNumber) {
          throw new BadRequestException('Cannot send OTP to a phone number not associated with your account');
      }

      await this.mfaOrchestratorService.sendPhoneOtp(user.id, phoneNumber);
      return { message: 'OTP sent successfully' };
  }

  @Post('verify-phone')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyPhoneOtp(@CurrentUser() user: User, @Body() body: { code: string, phoneNumber: string }) {
      // Use MfaOrchestratorService directly instead of AuthService pass-through
      return this.mfaOrchestratorService.verifyPhoneOtp(user.id, body.code, body.phoneNumber);
  }

  @Post('send-public-verification')
  @Public()
  @UseGuards(ThrottlerGuard, GoogleRecaptchaGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Send a verification code for unauthenticated users (email or phone)' })
  async sendPublicVerification(
    @Body() dto: SendPublicVerificationDto
  ) {
    await this.mfaOrchestratorService.sendPublicVerification(dto.target, dto.type);
    return { message: 'Si los datos son correctos, se ha enviado un código de verificación.' };
  }

  @Post('verify-public-code')
  @Public()
  @UseGuards(ThrottlerGuard, GoogleRecaptchaGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify a public code for unauthenticated users' })
  async verifyPublicCode(
    @Body() dto: VerifyPublicCodeDto
  ) {
    return this.mfaOrchestratorService.verifyPublicCode(dto.target, dto.type, dto.code);
  }

  @Post('confirm-email-magic-link')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify a registration email confirmation magic link' })
  async confirmEmailMagicLink(@Body() body: { token: string }) {
    return this.mfaOrchestratorService.confirmEmailMagicLink(body.token);
  }

  @Post('create-checkout-session')
  @ApiOperation({ summary: 'Create a Stripe checkout session for a selected plan' })
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async createCheckoutSession(
    @CurrentUser() user: User,
    @Body() body: CreateCheckoutSessionDto
  ) {
    const plans = await this.saasService.getPlans();
    const plan = plans.find(p => p.id === body.planId || p.slug === body.planId);
    if (!plan) {
      throw new BadRequestException('Plan not found');
    }

    const priceId = plan.monthlyPriceId;
    if (!priceId) {
      throw new BadRequestException('Plan does not have a price ID');
    }

    return this.paymentService.createCheckoutSession(
      user.organizationId,
      user.email,
      priceId,
      body.successUrl,
      body.cancelUrl
    );
  }

  @Post('verify-2fa')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verify2fa(
      @Body() dto: Verify2faDto,
      @Res({ passthrough: true }) res: Response,
      @Ip() ip: string,
      @Headers('user-agent') userAgent: string
  ) {
      const user = await this.authService.verify2faTempToken(dto.tempToken);
      if (!user) {
          throw new UnauthorizedException('Invalid or expired session');
      }

      // Use MfaOrchestratorService directly instead of AuthService pass-through
      const authResult = await this.mfaOrchestratorService.complete2faLogin(user, dto.code, ip, userAgent);

      const { user: authUser, accessToken, refreshToken } = authResult;

      this.cookieService.setAuthCookies(res, accessToken, refreshToken);
      return { user: authUser };
  }

  // ------------------------------------------------------------------
  // WebAuthn (Passkeys)
  // ------------------------------------------------------------------

  @Get('webauthn/register/options')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Generate WebAuthn registration options' })
  async generateWebAuthnRegistrationOptions(@CurrentUser() user: User) {
    return this.webAuthnService.generateRegistrationOptions(user);
  }

  @Post('webauthn/register/verify')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Verify WebAuthn registration' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyWebAuthnRegistration(@CurrentUser() user: User, @Body() body: VerifyWebAuthnRegistrationDto) {
    return this.webAuthnService.verifyRegistration(user, body);
  }

  @Post('webauthn/login/options')
  @Public()
  @ApiOperation({ summary: 'Generate WebAuthn authentication options' })
  async generateWebAuthnAuthenticationOptions(@Body('email') email?: string) {
    return this.webAuthnService.generateAuthenticationOptions(email);
  }

  @Post('webauthn/login/verify')
  @Public()
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
    // organisational policy by requiring the second factor before issuing session cookies —
    // consistent with the standard login flow in auth.service.ts.
    if (user.security?.isTwoFactorEnabled) {
      const expirationSeconds = Math.floor(AuthConfig.MFA_CODE_EXPIRATION / 1000);
      const tempToken = this.jwtService.sign(
        { id: user.id, type: '2fa_pending', tokenVersion: user.security.tokenVersion },
        { expiresIn: `${expirationSeconds}s`, secret: AuthConfig.JWT_2FA_TEMP_SECRET }
      );
      return { require2fa: true, tempToken, message: '2FA verification required' };
    }

    const { accessToken, refreshToken } = await this.authFacade.generateTokens(user);
    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
      // accessToken OMITTED — available exclusively via __Host-access_token cookie (CWE-200)
    };
  }

  // ------------------------------------------------------------------
  // Session Management
  // ------------------------------------------------------------------

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List active sessions (devices)' })
  async getUserSessions(@CurrentUser() user: User, @Req() req: Request) {
      let currentRefreshTokenId: string | undefined;
      const token = req.cookies['__Secure-refresh_token'] || req.cookies['refresh_token'];
      if (token) {
          try {
             // We decode to get the 'jti' (ID)
             const payload: any = this.jwtService.decode(token);
             if (payload && payload.jti) {
                 currentRefreshTokenId = payload.jti;
             }
          } catch(e) {}
      }
      return this.authService.getUserSessions(user.id, currentRefreshTokenId);
  }

  @Post('sessions/:id/revoke') // Using POST or DELETE is fine, usually DELETE for resource removal
  @UseGuards(JwtAuthGuard, CsrfGuard, TwoFactorVerifiedGuard)
  @ApiOperation({ summary: 'Revoke a specific session' })
  async revokeSession(
    @CurrentUser() user: User,
    @Param('id') sessionId: string,
  ) {
    return this.authService.revokeSession(user.id, sessionId);
  }
}
