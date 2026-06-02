import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { authenticator } from 'otplib';
import { User } from '../../users/entities/user.entity/user.entity';
import { CryptoUtil } from '../../shared/utils/crypto.util';
import { UserCacheService } from '../modules/user-cache.service';
import { UserSecurity } from '../../users/entities/user-security.entity';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { PasswordService } from './password.service';

@Injectable()
export class TwoFactorAuthService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(UserSecurity) private readonly userSecurityRepository: Repository<UserSecurity>,
    private readonly cryptoUtil: CryptoUtil,
    private readonly userCacheService: UserCacheService,
    private readonly configService: ConfigService,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Checks if 2FA is enabled for a user, fetching the security entity if necessary.
   */
  async isTwoFactorEnabled(user: User): Promise<boolean> {
    const security = user.security || await this.ensureSecurityEntity(user);
    return security.isTwoFactorEnabled;
  }

  async generateTwoFactorSecret(user: User) {
    const secret = authenticator.generateSecret();
    const appName = this.configService.get<string>('APP_NAME') || 'Virteex ERP';
    const otpauthUrl = authenticator.keyuri(user.email, appName, secret);

    // Encrypt secret before saving
    const encryptedSecret = this.cryptoUtil.encrypt(secret);

    let security = await this.ensureSecurityEntity(user);

    security.twoFactorSecret = encryptedSecret;
    await this.userSecurityRepository.save(security);

    return { secret, otpauthUrl };
  }

  /**
   * Pure verification of TOTP code (or Backup Code) without side effects.
   * Used for Step-up Authentication / Sudo Mode.
   */
  async verifyCode(user: User, code: string): Promise<boolean> {
      // 1. Try Backup Code first (if format matches backup code, e.g. 8 chars or hyphenated)
      // Backup codes are usually longer or formatted. TOTP is 6 digits.
      // Simple heuristic: If length > 6, try backup code.
      if (code.length > 6 || code.includes('-')) {
          return this.verifyBackupCode(user, code);
      }

      // 2. Try TOTP
      // We need the secret.
      const security = user.security || await this.ensureSecurityEntity(user);

      if (!security.isTwoFactorEnabled || !security.twoFactorSecret) {
          // If 2FA is not enabled, we cannot verify a code.
          // However, the Guard usually skips checking if 2FA is disabled.
          // If we reach here, it implies we want to verify.
          return false;
      }

      try {
          const decryptedSecret = this.cryptoUtil.decrypt(security.twoFactorSecret);
          return authenticator.verify({ token: code, secret: decryptedSecret });
      } catch (e) {
          return false;
      }
  }

  async enableTwoFactor(user: User, token: string, currentPassword: string) {
    const freshUser = await this.userRepository.findOne({
        where: { id: user.id },
        relations: ['security'],
    });

    if (!freshUser?.security?.twoFactorSecret) {
      throw new BadRequestException('2FA configuration not initiated. Please generate secret first.');
    }

    // H-05 FIX: Require current password as step-up before registering a new TOTP device.
    // This prevents an attacker with a stolen JWT from locking the real owner out by
    // binding their own authenticator app (NIST SP 800-63B §4.2; OWASP ASVS 2.2.2; CWE-306).
    if (!freshUser.security.passwordHash) {
      throw new BadRequestException('Password-based step-up is required but this account has no password set.');
    }
    const isPasswordValid = await this.passwordService.verify(freshUser.security.passwordHash, currentPassword);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const decryptedSecret = this.cryptoUtil.decrypt(freshUser.security.twoFactorSecret);
    const isValid = authenticator.verify({ token, secret: decryptedSecret });
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA token');
    }

    freshUser.security.isTwoFactorEnabled = true;

    const { codes, hashedCodes } = await this.createBackupCodes();
    freshUser.security.backupCodes = hashedCodes;

    await this.userSecurityRepository.save(freshUser.security);
    await this.userCacheService.clearUserSession(user.id);

    return { message: '2FA enabled successfully', backupCodes: codes };
  }

  async disableTwoFactor(user: User) {
      const freshUser = await this.userRepository.findOne({
        where: { id: user.id },
        relations: ['security']
      });

      if (freshUser && freshUser.security) {
          // Use update to force nulls/false
          await this.userSecurityRepository.save({
              id: freshUser.security.id,
              isTwoFactorEnabled: false,
              twoFactorSecret: null,
              backupCodes: null // Clear backup codes
          });
      }

      await this.userCacheService.clearUserSession(user.id);
      return { message: '2FA disabled successfully' };
  }

  // 10/10 SECURITY: Backup Codes Management
  async generateBackupCodes(user: User) {
      const security = await this.ensureSecurityEntity(user);

      if (!security.isTwoFactorEnabled) {
          throw new BadRequestException('Cannot generate backup codes if 2FA is not enabled.');
      }

      const { codes, hashedCodes } = await this.createBackupCodes();

      security.backupCodes = hashedCodes;
      await this.userSecurityRepository.save(security);

      return { codes };
  }

  async verifyBackupCode(user: User, code: string): Promise<boolean> {
      const security = user.security || (await this.ensureSecurityEntity(user));

      if (!security.backupCodes || security.backupCodes.length === 0) {
          return false;
      }

      // Check against all hashed codes
      // This is O(N) where N is small (e.g., 10). Acceptable.
      for (const hashedCode of security.backupCodes) {
          if (await argon2.verify(hashedCode, code)) {
              // Code is valid. Remove it (Burn on use).
              security.backupCodes = security.backupCodes.filter(c => c !== hashedCode);
              await this.userSecurityRepository.save(security);
              return true;
          }
      }

      return false;
  }

  private async createBackupCodes(): Promise<{ codes: string[], hashedCodes: string[] }> {
      const codes: string[] = [];
      const hashedCodes: string[] = [];

      for (let i = 0; i < 10; i++) {
          const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars
          // Format: XXXX-XXXX
          const formattedCode = `${code.slice(0, 4)}-${code.slice(4)}`;
          codes.push(formattedCode);
          hashedCodes.push(await argon2.hash(formattedCode));
      }

      return { codes, hashedCodes };
  }

  private async ensureSecurityEntity(user: User): Promise<UserSecurity> {
      let security = user.security;

      if (!security) {
          const freshUser = await this.userRepository.findOne({ where: { id: user.id }, relations: ['security'] });
          if (!freshUser) throw new UnauthorizedException('User not found');
          if (freshUser.security) return freshUser.security;
      } else {
          return security;
      }

      // Abstraction: Delegate creation to a safe method
      return this.safeCreateSecurity(user.id);
  }

  /**
   * Safely creates the security entity, handling race conditions via DB constraints.
   */
  private async safeCreateSecurity(userId: string): Promise<UserSecurity> {
      try {
           await this.userSecurityRepository.createQueryBuilder()
              .insert()
              .into(UserSecurity)
              .values({ userId, isTwoFactorEnabled: false })
              .orIgnore() // Handle race condition: if exists, do nothing
              .execute();
      } catch (e) {
          // Fallback if orIgnore fails for some provider-specific reason, though unlikely with Postgres
      }

      const security = await this.userSecurityRepository.findOne({ where: { userId } });
      if (!security) {
          throw new Error('Failed to ensure security entity');
      }
      return security;
  }
}
