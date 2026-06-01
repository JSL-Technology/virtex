
import { Controller, Post, Body, HttpCode, HttpStatus, Res, Get, UseGuards, Req, UsePipes, ValidationPipe, BadRequestException, UnauthorizedException, Param, Ip, Headers, Query, UseFilters, Header, SetMetadata } from '@nestjs/common';
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

import { SetPasswordFromInvitationDto } from './dto/set-password-from-invitation.dto';
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
import { MfaOrchestratorService } from './services/mfa-orchestrator.service';
import { JwtService } from '@nestjs/jwt';
import { TwoFactorVerifiedGuard } from './guards/two-factor-verified.guard';
import { Public, IS_PUBLIC_KEY } from './decorators/public.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

@ApiTags('Auth')
@Controller('auth')
@UseFilters(TypeOrmExceptionFilter)
@Public()
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
    private readonly jwtService: JwtService
  ) {}

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req: Request) {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@SocialUserDecorator() socialUser: SocialUser, @Res() res: Response) {
      await this.handleSocialCallback(socialUser, res);
  }

  @Get('microsoft')
  @UseGuards(AuthGuard('microsoft'))
  async microsoftAuth(@Req() req: Request) {}

  @Get('microsoft/callback')
  @UseGuards(AuthGuard('microsoft'))
  async microsoftAuthRedirect(@SocialUserDecorator() socialUser: SocialUser, @Res() res: Response) {
      await this.handleSocialCallback(socialUser, res);
  }

  @Get('okta')
  @UseGuards(AuthGuard('okta'))
  async oktaAuth(@Req() req: Request) {}

  @Get('okta/callback')
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

        // SECURITY 10/10: Use HTTP-only cookie to transfer PII token instead of URL parameter.
        // This prevents token leakage in browser history or referrer headers.
        res.cookie('social_register_token', registerToken, {
            httpOnly: true,
            secure: this.configService.get('NODE_ENV') === 'production',
            sameSite: 'lax',
            maxAge: 5 * 60 * 1000 // 5 minutes
        });

        // Redirect without token in URL
        return res.redirect(`${frontendUrl}/auth/register?social_registration=true`);
    }

    // Login successful
    this.cookieService.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res.redirect(`${frontendUrl}/dashboard`);
  }

  @Get('social-register-info')
  @ApiOperation({ summary: 'Decode social register token to pre-fill form' })
  async getSocialRegisterInfo(@Query('token') token: string, @Req() req: Request) {
      let tokenToUse = token;

      // Fallback to cookie if token not in query (for the new secure flow)
      if (!tokenToUse) {
          tokenToUse = req.cookies['social_register_token'];
      }

      if (!tokenToUse) {
          throw new BadRequestException('Token required (query or cookie)');
      }
      return this.authFacade.getSocialRegisterInfo(tokenToUse);
  }

  @Post('register')
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
    };
  }

  @Post('login')
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
    };
  }

  @Post('set-password-from-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: AuthResponseDto })
  @UseGuards(CsrfGuard)
  async setPasswordFromInvitation(
    @Body() setPasswordDto: SetPasswordFromInvitationDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const { user, accessToken, refreshToken } =
      await this.authFacade.setPasswordFromInvitation(setPasswordDto);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    return {
      user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }),
    };
  }

  @Get('invitation/:token')
  @HttpCode(HttpStatus.OK)
  async getInvitationDetails(@Param('token') token: string) {
    return this.passwordRecoveryService.getInvitationDetails(token);
  }

  @Get('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ type: AuthResponseDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string
  ): Promise<AuthResponseDto> {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      throw new BadRequestException('Refresh token no encontrado en cookies');
    }

    const result = await this.authService.refreshAccessToken(refreshToken, ip, userAgent);

    this.cookieService.setAuthCookies(res, result.accessToken, result.refreshToken);

    return {
      user: plainToInstance(UserResponseDto, result.user, { excludeExtraneousValues: true }),
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @SetMetadata(IS_PUBLIC_KEY, false)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async logout(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionId = (user as unknown as AuthenticatedUser).sessionId;
    await this.authService.logoutCurrentSession(user.id, sessionId);
    this.cookieService.clearAuthCookies(res);
    return { message: 'Logout exitoso' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @SetMetadata(IS_PUBLIC_KEY, false)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async logoutAll(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(user.id);
    this.cookieService.clearAuthCookies(res);
    return { message: 'Todas las sesiones han sido cerradas.' };
  }

  @Get('status')
  @SetMetadata(IS_PUBLIC_KEY, false)
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  async checkAuthStatus(@CurrentUser() user: User) {
    const statusResponse = await this.authService.status(user as unknown as AuthenticatedUser);
    return {
      isAuthenticated: true,
      user: plainToInstance(UserResponseDto, statusResponse.user, { excludeExtraneousValues: true }),
    };
  }

  @Post('forgot-password')
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
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe())
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    const user = await this.passwordRecoveryService.resetPassword(resetPasswordDto);
    const { passwordHash, ...userResult } = user;
    return userResult;
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
  @UseGuards(JwtAuthGuard, CsrfGuard)
  async impersonate(
    @CurrentUser() adminUser: User,
    @Body('userId') targetUserId: string,
    @Res({ passthrough: true }) res: Response
  ) {
    const { user, accessToken, refreshToken } =
      await this.authFacade.impersonate(adminUser, targetUserId);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    return { user };
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

    return { user };
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
  @ApiOperation({ summary: 'Verify token and enable 2FA' })
  async enableTwoFactor(
    @CurrentUser() user: User,
    @Body() enableTwoFactorDto: EnableTwoFactorDto,
  ) {
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
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } }) // Rate limit: 3 per minute
  async sendPhoneOtp(@CurrentUser() user: User, @Body('phoneNumber') phoneNumber: string) {
      if (!phoneNumber) {
          throw new BadRequestException('Phone number is required');
      }
      // Use MfaOrchestratorService directly instead of AuthService pass-through
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

  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } }) // Rate limit 2FA attempts
  async verify2fa(
      @Body() body: { code: string, tempToken: string },
      @Res({ passthrough: true }) res: Response,
      @Ip() ip: string,
      @Headers('user-agent') userAgent: string
  ) {
      const user = await this.authService.verify2faTempToken(body.tempToken);
      if (!user) {
          throw new UnauthorizedException('Invalid or expired session');
      }

      // Use MfaOrchestratorService directly instead of AuthService pass-through
      const authResult = await this.mfaOrchestratorService.complete2faLogin(user, body.code, ip, userAgent);

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
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Verify WebAuthn registration' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyWebAuthnRegistration(@CurrentUser() user: User, @Body() body: any) {
    return this.webAuthnService.verifyRegistration(user, body);
  }

  @Post('webauthn/login/options')
  @ApiOperation({ summary: 'Generate WebAuthn authentication options' })
  async generateWebAuthnAuthenticationOptions(@Body('email') email?: string) {
    return this.webAuthnService.generateAuthenticationOptions(email);
  }

  @Post('webauthn/login/verify')
  @ApiOperation({ summary: 'Verify WebAuthn authentication' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  @UseGuards(CsrfGuard)
  async verifyWebAuthnAuthentication(
    @Body() body: any,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.webAuthnService.verifyAuthentication(body);

    // Create session (same as regular login)
    const { accessToken, refreshToken } = await this.authFacade.generateTokens(result.user);

    this.cookieService.setAuthCookies(res, accessToken, refreshToken);

    return {
      user: plainToInstance(UserResponseDto, result.user, { excludeExtraneousValues: true }),
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
      const token = req.cookies['refresh_token'];
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
