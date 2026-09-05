import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Res,
  Ip,
  Headers,
} from '@nestjs/common';
import type { HttpResponse as Response, HttpRequest as Request } from '../common/http/http.types';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { GoogleRecaptchaGuard } from '@nestlab/google-recaptcha';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { AuthService } from './auth.service';
import { TwoFactorAuthService } from './services/two-factor-auth.service';
import { MfaOrchestratorService } from './services/mfa-orchestrator.service';
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
import { EnableTwoFactorDto } from './dto/enable-2fa.dto';
import { UserResponseDto } from './dto/user-response.dto';
import {
  Verify2faDto,
  SendPublicVerificationDto,
  VerifyPublicCodeDto,
} from './dto/security-audit.dto';
import {
  VerifyEmailCodeDto,
  SendPhoneOtpDto,
  VerifyPhoneOtpDto,
  ConfirmEmailMagicLinkDto,
} from './dto/auth-payloads.dto';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';
import { BadRequestError, UnauthorizedError } from '../i18n/localized.exception';

/**
 * Multi-factor authentication: TOTP/2FA lifecycle, backup codes, phone and email OTP, the public
 * verification codes the signup wizard uses, the registration magic link, and the second-factor
 * step of login (`verify-2fa`).
 *
 * Split out of `AuthController`; every route keeps its exact guards, scopes and throttles.
 * `@AllowInactiveSubscription` because completing a second factor and enrolling one are part of
 * authentication, which is never gated on billing.
 */
@ApiTags('Auth')
@AllowInactiveSubscription()
@Controller('auth')
export class AuthMfaController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorAuthService: TwoFactorAuthService,
    private readonly mfaOrchestratorService: MfaOrchestratorService,
    private readonly cookieService: CookieService,
    private readonly auditTrailService: AuditTrailService,
  ) {}

  // ------------------------------------------------------------------
  // Two-Factor Authentication (MFA)
  // ------------------------------------------------------------------

  @Post('2fa/generate')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Generate 2FA secret and QR code URL' })
  async generateTwoFactorSecret(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactorAuthService.generateTwoFactorSecret(user);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.ENABLE_2FA)
  @ApiOperation({ summary: 'Verify the code and enable 2FA — re-authentication is handled by StepUpGuard' })
  async enableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() enableTwoFactorDto: EnableTwoFactorDto,
    @Ip() ip: string
  ) {
    try {
      // No password is passed: StepUpGuard has already re-authenticated this caller with the
      // strongest factor the account holds, and burned the token doing it.
      const result = await this.twoFactorAuthService.enableTwoFactor(user, enableTwoFactorDto.token);
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'enable-2fa' }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'enable-2fa', error: (e as Error).message }, undefined, ip, user.organizationId);
      throw e;
    }
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.DISABLE_2FA)
  @ApiOperation({ summary: 'Disable 2FA' })
  async disableTwoFactor(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    try {
      const result = await this.twoFactorAuthService.disableTwoFactor(user);
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'disable-2fa' }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'disable-2fa', error: (e as Error).message }, undefined, ip, user.organizationId);
      throw e;
    }
  }

  @Post('2fa/backup-codes/generate')
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.REGENERATE_BACKUP_CODES)
  @ApiOperation({ summary: 'Generate new backup codes' })
  async generateBackupCodes(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    try {
      const result = await this.twoFactorAuthService.generateBackupCodes(user);
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'generate-backup-codes' }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'UserSecurity', user.id, ActionType.UPDATE, { action: 'generate-backup-codes', error: (e as Error).message }, undefined, ip, user.organizationId);
      throw e;
    }
  }

  @Post('2fa/send-email-verification')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Send email verification code for 2FA setup' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async sendEmailVerification(@CurrentUser() user: AuthenticatedUser) {
    await this.mfaOrchestratorService.sendEmailOtp(user.id, user.email);
    return { messageKey: 'AUTH.VERIFICATION_CODE_SENT_EMAIL' };
  }

  @Post('2fa/verify-email-verification')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiOperation({ summary: 'Verify email code for 2FA setup' })
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyEmailVerification(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyEmailCodeDto) {
    return this.mfaOrchestratorService.verifyEmailOtp(user.id, dto.code);
  }

  @Post('send-phone-otp')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async sendPhoneOtp(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendPhoneOtpDto) {
      // Presence + E.164 format are now enforced by SendPhoneOtpDto via the global ValidationPipe.
      const { phoneNumber } = dto;

      // Prevent SMS bombing: if the user already has a verified phone registered,
      // only allow sending OTP to that same number or to a new unverified one.
      // Sending to an arbitrary third-party number is not permitted.
      if (user.isPhoneVerified && user.phone && user.phone !== phoneNumber) {
          throw new BadRequestError('AUTH.CANNOT_SEND_OTP_PHONE_NUMBER_NOT_ASSOCIATED');
      }

      await this.mfaOrchestratorService.sendPhoneOtp(user.id, phoneNumber);
      return { messageKey: 'AUTH.OTP_SENT_SUCCESSFULLY' };
  }

  @Post('verify-phone')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verifyPhoneOtp(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyPhoneOtpDto) {
      // Use MfaOrchestratorService directly instead of AuthService pass-through
      return this.mfaOrchestratorService.verifyPhoneOtp(user.id, dto.code, dto.phoneNumber);
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
    return { messageKey: 'AUTH.SI_DATOS_SON_CORRECTOS_ENVIADO_CODIGO_VERIFICACION' };
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
  async confirmEmailMagicLink(@Body() dto: ConfirmEmailMagicLinkDto) {
    return this.mfaOrchestratorService.confirmEmailMagicLink(dto.token);
  }

  @Post('verify-2fa')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: AuthConfig.THROTTLE_LIMIT, ttl: AuthConfig.THROTTLE_TTL } })
  async verify2fa(
      @Body() dto: Verify2faDto,
      @Req() req: Request,
      @Res({ passthrough: true }) res: Response,
      @Ip() ip: string,
      @Headers('user-agent') userAgent: string
  ) {
      // H-03 FIX: Read pendingId from httpOnly cookie — never accept tempToken from body.
      // The cookie name is owned by CookieService: it depends on the environment and has changed
      // once already (the `__Host-` prefix is incompatible with the path this cookie needs), so
      // reading it by literal name here is how the two sides drift apart.
      const pendingId = this.cookieService.read2faPendingId(req.cookies);
      if (!pendingId) {
          throw new UnauthorizedError('AUTH.NO_ACTIVE_2FA_SESSION_PLEASE_LOG_IN');
      }

      // Loads the pending session and counts the attempt, but does NOT destroy it — a mistyped
      // code must not force the user to restart the whole login.
      const user = await this.authService.consume2faPendingSession(pendingId, ip, userAgent);

      const authResult = await this.mfaOrchestratorService.complete2faLogin(user, dto.code, ip, userAgent);

      const { user: authUser, accessToken, refreshToken } = authResult;

      // The second factor is verified: the pending session has served its purpose and must not
      // be replayable.
      await this.authService.clear2faPendingSession(pendingId);
      this.cookieService.clear2faPendingCookie(res);
      this.cookieService.setAuthCookies(res, accessToken, refreshToken, { userId: authUser?.id });
      // Through the DTO, like every other auth response. `buildSafeUser` only strips the
      // `security` relation, so returning its output directly leaked `invitationToken`,
      // `invitationTokenExpires` and `authProviderId` — and it did so on the ONE response that
      // completes a second-factor login (CWE-200).
      return { user: plainToInstance(UserResponseDto, authUser, { excludeExtraneousValues: true }) };
  }
}
