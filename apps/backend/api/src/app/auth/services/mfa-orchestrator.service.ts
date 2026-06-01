import { Injectable, UnauthorizedException, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomInt, randomUUID, createHash } from 'crypto';

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

import { AuthConfig } from '../auth.config';

@Injectable()
export class MfaOrchestratorService {
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
    private readonly mailService: MailService
  ) {}

  async sendEmailOtp(userId: string, email: string) {
    const user = await this.usersService.findOne(userId);
    if (!user) throw new BadRequestException('User not found');

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
      throw new BadRequestException('No verification code found or expired.');
    }

    if (new Date() > record.expiresAt) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestException('Verification code expired.');
    }

    // 10/10 SECURITY: Brute force protection for OTP
    record.attempts += 1;
    record.lastAttemptAt = new Date();

    if (record.attempts > 5) {
        await this.verificationCodeRepository.delete(record.id);
        throw new BadRequestException('Too many attempts. Please request a new code.');
    }

    await this.verificationCodeRepository.save(record);

    const isValid = await argon2.verify(record.code, code);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code.');
    }

    await this.verificationCodeRepository.delete(record.id);

    return { message: 'Email verified successfully.' };
  }

  async sendPhoneOtp(userId: string, phoneNumber: string) {
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
      throw new BadRequestException('No verification code found or expired.');
    }

    if (new Date() > record.expiresAt) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestException('Verification code expired.');
    }

    // Brute-force protection — mirrors verifyEmailOtp (CWE-307, NIST SP 800-63B §5.2.2)
    record.attempts += 1;
    record.lastAttemptAt = new Date();
    if (record.attempts > 5) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestException('Too many attempts. Please request a new code.');
    }
    await this.verificationCodeRepository.save(record);

    // Validate that the OTP was issued for this specific phone number (stored in `target`)
    if (record.target && record.target !== phoneNumber) {
      throw new BadRequestException('Invalid phone number for this verification code.');
    }

    const isValid = await argon2.verify(record.code, code);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code.');
    }

    await this.usersService.update(userId, {
      phone: phoneNumber,
      isPhoneVerified: true
    });

    await this.verificationCodeRepository.delete(record.id);

    return { message: 'Phone number verified successfully.' };
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

  async sendPublicVerification(target: string, type: VerificationType) {
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
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4200');
      const magicLinkUrl = `${frontendUrl}/es/auth/register?email_token=${encodeURIComponent(magicLinkToken)}`;
      const expiresMinutes = Math.round(AuthConfig.MFA_CODE_EXPIRATION / 60000);
      await this.mailService.sendRegistrationEmailVerification(target, code, 'Usuario', magicLinkUrl, expiresMinutes);
    } else if (type === VerificationType.PHONE_VERIFY) {
      await this.smsProvider.send(target, `Your verification code is: ${code}`);
    }
  }

  async verifyPublicCode(target: string, type: VerificationType, code: string) {
    const record = await this.verificationCodeRepository.findOne({
      where: { target, type },
    });

    if (!record) {
      throw new BadRequestException('No verification code found or expired.');
    }

    if (new Date() > record.expiresAt) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestException('Verification code expired.');
    }

    // Brute force protection
    record.attempts += 1;
    record.lastAttemptAt = new Date();
    if (record.attempts > 5) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestException('Too many attempts. Please request a new code.');
    }
    await this.verificationCodeRepository.save(record);

    const isValid = await argon2.verify(record.code, code);
    if (!isValid) {
      throw new BadRequestException('Invalid verification code.');
    }

    await this.verificationCodeRepository.delete(record.id);

    // Key separation: pre-verification tokens use their own secret (NIST SP 800-57 §5.2, CWE-321)
    const preVerifiedToken = this.jwtService.sign(
      { sub: target, verType: type, type: 'VERIFICATION_PRE_VERIFIED' },
      { secret: AuthConfig.JWT_PREVERIFY_SECRET, expiresIn: '30m' },
    );

    return { message: 'Verified successfully.', preVerifiedToken };
  }

  async confirmEmailMagicLink(token: string): Promise<{ preVerifiedToken: string }> {
    let payload: { email: string; nonce: string; type: string };

    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow('JWT_SECRET'),
      });
    } catch {
      throw new BadRequestException('El enlace de verificación ha expirado o no es válido.');
    }

    if (payload.type !== 'reg_email_magic_link') {
      throw new BadRequestException('Tipo de token inválido.');
    }

    const record = await this.verificationCodeRepository.findOne({
      where: { target: payload.email, type: VerificationType.EMAIL_VERIFY },
    });

    if (!record) {
      throw new BadRequestException('El enlace de verificación ya fue usado o ha expirado.');
    }

    if (new Date() > record.expiresAt) {
      await this.verificationCodeRepository.delete(record.id);
      throw new BadRequestException('El enlace de verificación ha expirado.');
    }

    if (record.payload !== payload.nonce) {
      throw new BadRequestException('El enlace de verificación no es válido.');
    }

    await this.verificationCodeRepository.delete(record.id);

    // Key separation: pre-verification tokens use their own secret (NIST SP 800-57 §5.2, CWE-321)
    const preVerifiedToken = this.jwtService.sign(
      { sub: payload.email, verType: VerificationType.EMAIL_VERIFY, type: 'VERIFICATION_PRE_VERIFIED' },
      { secret: AuthConfig.JWT_PREVERIFY_SECRET, expiresIn: '30m' },
    );

    return { preVerifiedToken };
  }

  async complete2faLogin(user: User, code: string, ipAddress?: string, userAgent?: string) {
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
         await this.auditService.record(
            user.id,
            'User',
            user.id,
            ActionType.LOGIN_FAILED,
            {
              emailHash: createHash('sha256').update(user.email).digest('hex').slice(0, 16),
              reason: 'Invalid 2FA/Backup Code',
            },
            undefined
         );
         throw new UnauthorizedException('Código 2FA o de recuperación inválido');
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
          emailHash: createHash('sha256').update(user.email).digest('hex').slice(0, 16),
          ipAddressMasked: ipAddress ? ipAddress.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.*.*') : undefined,
          userAgentTruncated: userAgent ? userAgent.substring(0, 100) : undefined,
          method,
        },
        undefined,
    );

    return await this.tokenService.generateAuthResponse(user, {}, ipAddress, userAgent);
  }
}
