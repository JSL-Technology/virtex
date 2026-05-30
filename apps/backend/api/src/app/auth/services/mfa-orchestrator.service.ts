import { Injectable, UnauthorizedException, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';

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
      payload: email,
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
      payload: phoneNumber, // Bind code to specific phone number
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

    // Security: Check if phone number matches the one the code was sent to
    if (record.payload && record.payload !== phoneNumber) {
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
            user.organizationId,
            'User',
            user.id,
            ActionType.LOGIN_FAILED,
            { email: user.email, reason: 'Invalid 2FA/Backup Code' },
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

    await this.auditService.record(
        user.id,
        user.organizationId,
        'User',
        user.id,
        ActionType.LOGIN,
        { email: user.email, ipAddress, userAgent, method },
        undefined,
    );

    return await this.tokenService.generateAuthResponse(user, {}, ipAddress, userAgent);
  }
}
