import { Injectable, Inject, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomInt, randomUUID } from 'crypto';

import { User } from '../../users/entities/user.entity/user.entity';
import { VerificationCode, VerificationType } from '../entities/verification-code.entity';
import { MailService } from '../../mail/mail.service';
import { AbstractSmsProvider } from './abstract-sms.provider';
import { SecurityAnalysisService } from './security-analysis.service';
import { AuditTrailService } from '../../audit/audit.service';
import { ActionType } from '../../audit/entities/audit-log.entity';
import { TokenService } from './token.service';
import { UsersService } from '../../users/users.service';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { FrontendUrlService } from '../../mail/frontend-url.service';
import { SmsAbuseGuardService } from './sms-abuse.guard.service';

import { AuthConfig } from '../auth.config';
import { BadRequestError, InternalServerError, UnauthorizedError } from '../../i18n/localized.exception';

/** A stable, non-identifying handle for a verification destination, for logs. */
function hashTarget(target: string): string {
  return crypto.createHash('sha256').update(target.toLowerCase().trim()).digest('hex').slice(0, 12);
}

/**
 * Canonicalise a verification destination to the case it is stored and looked up under.
 *
 * The HTTP DTOs already do this, but the code stored against a `target` and the pre-verification
 * token's `sub` are security-relevant bindings, so the invariant is re-asserted here rather than
 * trusted to every present and future caller. Trimming and lower-casing leave an E.164 phone
 * number untouched (it carries no letters) and bring an email into one canonical form.
 */
function normalizeTarget(target: string): string {
  return typeof target === 'string' ? target.trim().toLowerCase() : target;
}

@Injectable()
export class MfaOrchestratorService {
  private readonly logger = new Logger(MfaOrchestratorService.name);

  constructor(
    @InjectRepository(VerificationCode)
    private readonly verificationCodeRepository: Repository<VerificationCode>,
    @InjectRepository(UserSecurity)
    private readonly userSecurityRepository: Repository<UserSecurity>,
    private readonly smsProvider: AbstractSmsProvider,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly securityAnalysisService: SecurityAnalysisService,
    private readonly auditService: AuditTrailService,
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService,
    private readonly twoFactorAuthService: TwoFactorAuthService,
    private readonly mailService: MailService,
    private readonly links: FrontendUrlService,
    private readonly smsAbuseGuard: SmsAbuseGuardService
  ) {}

  async sendEmailOtp(userId: string, email: string) {
    // Only the first name is needed, for the greeting. `findOne` now requires a tenant because
    // it resolves roles, and loading an authorization graph to address an email would be absurd.
    const user = await this.usersService.findBasicById(userId);
    if (!user) throw new BadRequestError('AUTH.USER_NOT_FOUND');

    const code = randomInt(100000, 999999).toString();
    const hash = await argon2.hash(code);

    await this.verificationCodeRepository.delete({ userId, type: VerificationType.EMAIL_VERIFY });

    const verificationCode = this.verificationCodeRepository.create({
      userId,
      code: hash,
      target: email,
      type: VerificationType.EMAIL_VERIFY,
      expiresAt: new Date(Date.now() + AuthConfig.MFA_CODE_EXPIRATION),
    });

    await this.verificationCodeRepository.save(verificationCode);

    await this.mailService.sendVerificationCodeEmail(email, code, user.firstName);
  }

  async verifyEmailOtp(userId: string, code: string) {
    const record = await this.verificationCodeRepository.findOne({
      where: { userId, type: VerificationType.EMAIL_VERIFY },
    });

    if (!record) {
      throw new BadRequestError('AUTH.NO_VERIFICATION_CODE_FOUND_OR_EXPIRED');
    }

    if (new Date() > record.expiresAt) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestError('AUTH.VERIFICATION_CODE_EXPIRED');
    }

    // 10/10 SECURITY: Brute force protection for OTP
    record.attempts += 1;
    record.lastAttemptAt = new Date();

    if (record.attempts > 5) {
        await this.verificationCodeRepository.delete(record.id);
        throw new BadRequestError('AUTH.TOO_MANY_ATTEMPTS_PLEASE_REQUEST_NEW_CODE');
    }

    await this.verificationCodeRepository.save(record);

    const isValid = await argon2.verify(record.code, code);
    if (!isValid) {
      throw new BadRequestError('AUTH.INVALID_VERIFICATION_CODE');
    }

    await this.verificationCodeRepository.delete(record.id);

    return { messageKey: 'AUTH.EMAIL_VERIFIED_SUCCESSFULLY' };
  }

  async sendPhoneOtp(userId: string, phoneNumber: string) {
    // Authenticated, but the destination is still caller-supplied, so it spends the same budget.
    await this.smsAbuseGuard.assertMaySend(phoneNumber);

    const code = randomInt(100000, 999999).toString();
    const hash = await argon2.hash(code);

    await this.verificationCodeRepository.delete({ userId, type: VerificationType.PHONE_VERIFY });

    const verificationCode = this.verificationCodeRepository.create({
      userId,
      code: hash,
      target: phoneNumber, // Bind code to specific phone number
      type: VerificationType.PHONE_VERIFY,
      expiresAt: new Date(Date.now() + AuthConfig.MFA_CODE_EXPIRATION),
    });

    await this.verificationCodeRepository.save(verificationCode);

    await this.smsProvider.send(phoneNumber, `Your verification code is: ${code}`);
  }

  async verifyPhoneOtp(userId: string, code: string, phoneNumber: string) {
    const record = await this.verificationCodeRepository.findOne({
      where: { userId, type: VerificationType.PHONE_VERIFY },
    });

    if (!record) {
      throw new BadRequestError('AUTH.NO_VERIFICATION_CODE_FOUND_OR_EXPIRED');
    }

    if (new Date() > record.expiresAt) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestError('AUTH.VERIFICATION_CODE_EXPIRED');
    }

    // Brute-force protection — mirrors verifyEmailOtp (CWE-307, NIST SP 800-63B §5.2.2)
    record.attempts += 1;
    record.lastAttemptAt = new Date();
    if (record.attempts > 5) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestError('AUTH.TOO_MANY_ATTEMPTS_PLEASE_REQUEST_NEW_CODE');
    }
    await this.verificationCodeRepository.save(record);

    // Validate that the OTP was issued for this specific phone number (stored in `target`)
    if (record.target && record.target !== phoneNumber) {
      throw new BadRequestError('AUTH.INVALID_PHONE_NUMBER_FOR_THIS_VERIFICATION_CODE');
    }

    const isValid = await argon2.verify(record.code, code);
    if (!isValid) {
      throw new BadRequestError('AUTH.INVALID_VERIFICATION_CODE');
    }

    await this.usersService.update(userId, {
      phone: phoneNumber,
      isPhoneVerified: true
    });

    await this.verificationCodeRepository.delete(record.id);

    return { messageKey: 'AUTH.PHONE_NUMBER_VERIFIED_SUCCESSFULLY' };
  }

  async sendLoginOtp(user: User) {
      const code = randomInt(100000, 999999).toString();
      const hash = await argon2.hash(code);

      await this.verificationCodeRepository.delete({ userId: user.id, type: VerificationType.LOGIN_2FA });

      await this.verificationCodeRepository.save({
          userId: user.id,
          code: hash,
          type: VerificationType.LOGIN_2FA,
          expiresAt: new Date(Date.now() + AuthConfig.MFA_CODE_EXPIRATION)
      });

      if (user.phone) {
          await this.smsProvider.send(user.phone, `Your Login Code: ${code}`);
      }
  }

  async sendPublicVerification(rawTarget: string, type: VerificationType) {
    const target = normalizeTarget(rawTarget);
    const code = randomInt(100000, 999999).toString();
    const hash = await argon2.hash(code);

    await this.verificationCodeRepository.delete({ target, type });

    let magicLinkNonce: string | undefined;
    if (type === VerificationType.EMAIL_VERIFY) {
      magicLinkNonce = randomUUID();
    }

    const verificationCode = this.verificationCodeRepository.create({
      target,
      code: hash,
      type,
      payload: magicLinkNonce,
      expiresAt: new Date(Date.now() + AuthConfig.MFA_CODE_EXPIRATION),
    });

    await this.verificationCodeRepository.save(verificationCode);

    if (type === VerificationType.EMAIL_VERIFY) {
      const magicLinkToken = this.jwtService.sign(
        { email: target, nonce: magicLinkNonce, type: 'reg_email_magic_link' },
        {
          secret: this.configService.getOrThrow('JWT_SECRET'),
          expiresIn: '15m',
        },
      );
      // Was `/es/auth/register`, which has no country segment and therefore matches no route:
      // the link landed on the authenticated shell, whose guard redirected to the login page and
      // dropped `email_token` on the way. Every registration confirmation email was a dead end.
      const magicLinkUrl = this.links.confirmRegistrationEmail(magicLinkToken);
      const expiresMinutes = Math.round(AuthConfig.MFA_CODE_EXPIRATION / 60000);
      try {
        await this.mailService.sendRegistrationEmailVerification(target, code, 'Usuario', magicLinkUrl, expiresMinutes);
      } catch (err) {
        // Hashed, not in the clear: the address is personal data and this is the one place the
        // module wrote one out in full.
        this.logger.error(
          { event: 'registration_email_failed', targetHash: hashTarget(target) },
          `Failed to send registration verification email: ${(err as Error).message}`,
        );
        throw new InternalServerError('AUTH.NO_PUDO_ENVIAR_CORREO_VERIFICACION_FAVOR_VERIFICA');
      }
    } else if (type === VerificationType.PHONE_VERIFY) {
      // Unauthenticated, and it sends to whatever number the body carries — the exact shape of
      // SMS pumping. reCAPTCHA and a per-IP throttle do not stop it; refusing destinations the
      // product does not sell to, and capping what one campaign can cost, does.
      await this.smsAbuseGuard.assertMaySend(target);
      try {
        await this.smsProvider.send(target, `Your verification code is: ${code}`);
      } catch (err) {
        this.logger.error(
          { event: 'verification_sms_failed', targetHash: hashTarget(target) },
          `Failed to send verification SMS: ${(err as Error).message}`,
        );
        throw new InternalServerError('AUTH.NO_PUDO_ENVIAR_SMS_VERIFICACION_FAVOR_INTENTA');
      }
    }
  }

  async verifyPublicCode(rawTarget: string, type: VerificationType, code: string) {
    const target = normalizeTarget(rawTarget);
    const record = await this.verificationCodeRepository.findOne({
      where: { target, type },
    });

    if (!record) {
      throw new BadRequestError('AUTH.NO_VERIFICATION_CODE_FOUND_OR_EXPIRED');
    }

    if (new Date() > record.expiresAt) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestError('AUTH.VERIFICATION_CODE_EXPIRED');
    }

    // Brute force protection
    record.attempts += 1;
    record.lastAttemptAt = new Date();
    if (record.attempts > 5) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestError('AUTH.TOO_MANY_ATTEMPTS_PLEASE_REQUEST_NEW_CODE');
    }
    await this.verificationCodeRepository.save(record);

    const isValid = await argon2.verify(record.code, code);
    if (!isValid) {
      throw new BadRequestError('AUTH.INVALID_VERIFICATION_CODE');
    }

    await this.verificationCodeRepository.delete(record.id);

    // Key separation: pre-verification tokens use their own secret (NIST SP 800-57 §5.2, CWE-321)
    const preVerifiedToken = this.jwtService.sign(
      { sub: target, verType: type, type: 'VERIFICATION_PRE_VERIFIED' },
      { secret: AuthConfig.JWT_PREVERIFY_SECRET, expiresIn: '30m' },
    );

    return { messageKey: 'AUTH.VERIFIED_SUCCESSFULLY', preVerifiedToken };
  }

  async confirmEmailMagicLink(token: string): Promise<{ preVerifiedToken: string }> {
    let payload: { email: string; nonce: string; type: string };

    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow('JWT_SECRET'),
      });
    } catch {
      throw new BadRequestError('AUTH.ENLACE_VERIFICACION_HA_EXPIRADO_NO_ES_VALIDO');
    }

    if (payload.type !== 'reg_email_magic_link') {
      throw new BadRequestError('AUTH.TIPO_TOKEN_INVALIDO');
    }

    // The token was minted from an already-canonical target, but the lookup and the
    // pre-verification `sub` are re-normalised so a token signed before this change still resolves.
    const email = normalizeTarget(payload.email);

    const record = await this.verificationCodeRepository.findOne({
      where: { target: email, type: VerificationType.EMAIL_VERIFY },
    });

    if (!record) {
      throw new BadRequestError('AUTH.ENLACE_VERIFICACION_YA_FUE_USADO_HA_EXPIRADO');
    }

    if (new Date() > record.expiresAt) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestError('AUTH.ENLACE_VERIFICACION_HA_EXPIRADO');
    }

    if (record.payload !== payload.nonce) {
      throw new BadRequestError('AUTH.ENLACE_VERIFICACION_NO_ES_VALIDO');
    }

    await this.verificationCodeRepository.delete(record.id);

    // Key separation: pre-verification tokens use their own secret (NIST SP 800-57 §5.2, CWE-321)
    const preVerifiedToken = this.jwtService.sign(
      { sub: email, verType: VerificationType.EMAIL_VERIFY, type: 'VERIFICATION_PRE_VERIFIED' },
      { secret: AuthConfig.JWT_PREVERIFY_SECRET, expiresIn: '30m' },
    );

    return { preVerifiedToken };
  }

  async complete2faLogin(user: User, code: string, ipAddress?: string, userAgent?: string) {
      // A locked account cannot complete a second factor either.
      //
      // The lockout was only ever consulted on the password step, so once an attacker had the
      // password the second factor was an unbounded oracle: every wrong code was rejected and
      // nothing accumulated. Checking here closes both routes into this method — the inline
      // `twoFactorCode` on POST /auth/login and the cookie-bound POST /auth/verify-2fa.
      if (user.security?.lockoutUntil && new Date() < user.security.lockoutUntil) {
          throw new UnauthorizedError('AUTH.CUENTA_BLOQUEADA_TEMPORALMENTE_DEMASIADOS_INTENTOS_INTENTALO_MAS');
      }

      // 1. Try Standard TOTP
      let isValid2FA = await this.securityAnalysisService.validateTwoFactorCode(user, code);
      let method = '2FA';

      // 2. If TOTP failed, try Backup Code
      if (!isValid2FA) {
          // Check format of backup code (e.g., 8 chars) to avoid unnecessary DB hits?
          // Nah, just try verify.
          const isBackupCode = await this.twoFactorAuthService.verifyBackupCode(user, code);
          if (isBackupCode) {
              isValid2FA = true;
              method = 'BACKUP_CODE';
          }
      }

      if (!isValid2FA) {
         // A failed second factor counts against the same lockout budget as a failed password.
         //
         // Nothing did this before. `POST /auth/login` accepts `twoFactorCode` in the same body as
         // the password (see LoginUserDto), and that path never touches the pending-session
         // counter, so an attacker who already held the password could grind six-digit codes
         // bounded only by a per-IP throttle — trivially evaded from a botnet — against an account
         // that would never lock. Counting the attempt here covers every route that completes a
         // second factor, because they all arrive through this method.
         // (NIST SP 800-63B §5.2.2; OWASP ASVS 2.2.1; CWE-307.)
         await this.securityAnalysisService.handleFailedLoginAttempt(user);

         await this.auditService.record(
            user.id,
            'User',
            user.id,
            ActionType.LOGIN_FAILED,
            {
              emailHash: crypto.createHash('sha256').update((user.email || '').toLowerCase().trim()).digest('hex').slice(0, 12),
              reason: 'Invalid 2FA/Backup Code',
            },
            undefined
         );
         throw new UnauthorizedError('AUTH.CODIGO_2FA_RECUPERACION_INVALIDO');
      }

    // Reset attempts on successful 2FA
    if (user.security && (user.security.failedLoginAttempts > 0 || user.security.lockoutUntil)) {
       user.security.failedLoginAttempts = 0;
       user.security.lockoutUntil = null;
       await this.userSecurityRepository.save(user.security);
    }

    // H-13 FIX: Minimize PII in audit payloads. Store userId as primary identifier;
    // use hashed email (not plain-text) and truncated UA to reduce exposure in logs
    // (OWASP Logging Cheat Sheet; GDPR data minimization; CWE-532).
    await this.auditService.record(
        user.id,
        'User',
        user.id,
        ActionType.LOGIN,
        {
          emailHash: crypto.createHash('sha256').update((user.email || '').toLowerCase().trim()).digest('hex').slice(0, 12),
          ipHash: ipAddress ? crypto.createHash('sha256').update(ipAddress).digest('hex').slice(0, 12) : undefined,
          uaHash: userAgent ? crypto.createHash('sha256').update(userAgent).digest('hex').slice(0, 12) : undefined,
          method,
        },
        undefined,
    );

    return await this.tokenService.generateAuthResponse(user, {}, ipAddress, userAgent);
  }
}
