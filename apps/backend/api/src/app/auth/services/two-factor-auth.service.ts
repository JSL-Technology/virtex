import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { authenticator } from 'otplib';
import { User } from '../../users/entities/user.entity/user.entity';
import { CryptoUtil } from '../../shared/utils/crypto.util';
import { UserCacheService } from '../modules/user-cache.service';
import { UserSecurity } from '../../users/entities/user-security.entity';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PasswordService } from './password.service';
import { AuthConfig } from '../auth.config';
import { UserIdentity } from '../interfaces/authenticated-user.interface';
import { BadRequestError, UnauthorizedError } from '../../i18n/localized.exception';

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
  async isTwoFactorEnabled(user: UserIdentity): Promise<boolean> {
    const security = user.security || await this.ensureSecurityEntity(user);
    return security.isTwoFactorEnabled;
  }

  /**
   * Begin TOTP enrolment.
   *
   * A-5 FIX: the candidate secret is staged in `pendingTwoFactorSecret` and the call is refused
   * outright when 2FA is already active.
   *
   * Previously this wrote directly into `twoFactorSecret` with no check on
   * `isTwoFactorEnabled`, and the endpoint required nothing but a valid session. An attacker
   * with a hijacked session could therefore replace the secret of an account that already had
   * 2FA on: the flag stayed true, so the owner's authenticator stopped matching and they were
   * locked out of their own account without any confirmation step ever running.
   *
   * Re-enrolling a new device is still possible — via disable (which requires step-up plus the
   * current second factor) followed by enrol.
   */
  async generateTwoFactorSecret(user: UserIdentity) {
    const security = await this.ensureSecurityEntity(user);

    if (security.isTwoFactorEnabled) {
      throw new BadRequestError('AUTH.VERIFICACION_DOS_PASOS_YA_ESTA_ACTIVA_DESACTIVALA');
    }

    const secret = authenticator.generateSecret();
    const appName = this.configService.get<string>('APP_NAME') || 'Virtex';
    const otpauthUrl = authenticator.keyuri(user.email, appName, secret);

    security.pendingTwoFactorSecret = this.cryptoUtil.encrypt(secret);
    await this.userSecurityRepository.save(security);

    return { secret, otpauthUrl };
  }

  /**
   * Pure verification of TOTP code (or Backup Code) without side effects.
   * Used for Step-up Authentication / Sudo Mode.
   */
  async verifyCode(user: UserIdentity, code: string): Promise<boolean> {
      const normalized = (code ?? '').trim().toUpperCase();
      if (!normalized) return false;

      // Backup codes are issued as XXXX-XXXX; TOTP is exactly six digits. Routing on the exact
      // shape rather than on "length > 6" means a mistyped 7-digit TOTP is rejected as a TOTP
      // instead of being silently sent down the backup-code path.
      const isTotpShaped = /^\d{6}$/.test(normalized);
      if (!isTotpShaped) {
          return this.verifyBackupCode(user, normalized);
      }

      const security = user.security || await this.ensureSecurityEntity(user);

      if (!security.isTwoFactorEnabled || !security.twoFactorSecret) {
          return false;
      }

      try {
          const decryptedSecret = this.cryptoUtil.decrypt(security.twoFactorSecret);
          return await this.verifyTotpWithReplayProtection(security, decryptedSecret, normalized);
      } catch {
          return false;
      }
  }

  /**
   * A-6 FIX: verify a TOTP code and burn the time-step it belongs to.
   *
   * A code remains valid for its whole 30-second step (plus the configured skew window), so
   * without recording what has been spent the same six digits can be replayed repeatedly inside
   * that window. That matters here beyond login: step-up re-authentication accepts the same code to
   * authorise sensitive operations, so one observed code could authorise several of them.
   * NIST SP 800-63B §5.1.4.2 requires the verifier to reject an already-used OTP.
   *
   * The step is persisted with a conditional UPDATE, so two concurrent requests presenting the
   * same code cannot both win: exactly one row update succeeds.
   */
  private async verifyTotpWithReplayProtection(
      security: UserSecurity,
      secret: string,
      code: string,
  ): Promise<boolean> {
      const window = AuthConfig.TOTP_WINDOW;
      const stepSeconds = AuthConfig.TOTP_STEP_SECONDS;
      const currentStep = Math.floor(Date.now() / 1000 / stepSeconds);

      // Identify which step within the accepted window this code belongs to.
      let matchedStep: number | null = null;
      for (let offset = -window; offset <= window; offset++) {
          const candidateStep = currentStep + offset;
          // `authenticator.generate` takes only the secret; the epoch is set on the instance.
          // Passing it as a second argument was silently ignored, so EVERY candidate step in the
          // window generated the code for the CURRENT time — the drift window did nothing.
          const expected = authenticator.clone({ epoch: candidateStep * stepSeconds * 1000 })
              .generate(secret);
          // Constant-time comparison: both operands are fixed-length numeric strings.
          if (expected.length === code.length &&
              crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) {
              matchedStep = candidateStep;
              break;
          }
      }

      if (matchedStep === null) return false;

      const lastStep = security.lastTotpStep != null ? Number(security.lastTotpStep) : null;
      if (lastStep !== null && matchedStep <= lastStep) {
          // Already spent (or an older step being replayed).
          return false;
      }

      // Atomic claim: only the first request to burn this step succeeds.
      const claim = await this.userSecurityRepository
          .createQueryBuilder()
          .update(UserSecurity)
          .set({ lastTotpStep: String(matchedStep) })
          .where('id = :id', { id: security.id })
          .andWhere('(last_totp_step IS NULL OR last_totp_step < :step)', { step: matchedStep })
          .execute();

      if (!claim.affected) return false;

      security.lastTotpStep = String(matchedStep);
      return true;
  }

  /**
   * Verify a user's account password.
   *
   * Lives here rather than in the guard so that the step-up path keeps depending only on
   * services every module that uses it can already resolve. Injecting UsersService into the guard
   * would have broken RolesModule at runtime, since it imports AuthModule but not UsersModule —
   * a failure that only appears when the route is actually hit.
   *
   * @returns false when the account has no local password (a pure SSO identity), so the caller
   *          can decide the policy rather than having it silently succeed.
   */
  async verifyAccountPassword(userId: string, password: string): Promise<boolean> {
      const user = await this.userRepository.findOne({
          where: { id: userId },
          relations: ['security'],
      });

      const hash = user?.security?.passwordHash;
      if (!hash) return false;

      return this.passwordService.verify(hash, password);
  }

  /** Whether the account can be challenged for a password at all (federated identities cannot). */
  async hasLocalPassword(userId: string): Promise<boolean> {
      const user = await this.userRepository.findOne({
          where: { id: userId },
          relations: ['security'],
      });
      return Boolean(user?.security?.passwordHash);
  }

  /**
   * Bind a verified TOTP authenticator to the account.
   *
   * Re-authentication is NOT performed here. `StepUpGuard` with `StepUpScope.ENABLE_2FA` already
   * proved the caller's identity with the strongest factor the account holds, and did so before
   * this method was reached — that is the whole point of having one step-up mechanism.
   *
   * Asking for the password a second time was not defence in depth, it was a second, weaker
   * gate that made the feature unusable:
   *
   *   - The settings screen calls this AFTER completing step-up, so it had no password to send
   *     and passed an empty string. `@IsNotEmpty()` on the DTO then rejected every request with
   *     400 before the service ran, and the client rendered that as "invalid code" — so nobody,
   *     on any account, could enable 2FA from the product.
   *   - A federated identity has no `passwordHash` at all, so even with the client fixed this
   *     threw `BadRequestException` for every SSO and social account. Enabling a second factor
   *     is exactly what those accounts need in order to stop depending on the IdP.
   *
   * The protection the password was there to provide (an attacker with a stolen session binding
   * their own authenticator) is provided by the step-up guard, which demands a fresh credential
   * and burns the token on first use — see SINGLE_USE_SCOPES.
   */
  async enableTwoFactor(user: UserIdentity, token: string) {
    const freshUser = await this.userRepository.findOne({
        where: { id: user.id },
        relations: ['security'],
    });

    if (!freshUser?.security?.pendingTwoFactorSecret) {
      throw new BadRequestError('AUTH.2FA_CONFIGURATION_NOT_INITIATED_PLEASE_GENERATE_SECRET');
    }

    // Validate against the STAGED secret. Only once the user has proved they can generate a
    // correct code is it promoted to the live secret — so an abandoned or hostile enrolment
    // never displaces a working authenticator.
    const decryptedSecret = this.cryptoUtil.decrypt(freshUser.security.pendingTwoFactorSecret);
    const isValid = authenticator.verify({ token, secret: decryptedSecret });
    if (!isValid) {
      throw new UnauthorizedError('AUTH.INVALID_2FA_TOKEN');
    }

    freshUser.security.twoFactorSecret = freshUser.security.pendingTwoFactorSecret;
    freshUser.security.pendingTwoFactorSecret = null;
    freshUser.security.isTwoFactorEnabled = true;
    // Start the replay window fresh for the newly bound authenticator.
    freshUser.security.lastTotpStep = null;

    const { codes, hashedCodes } = await this.createBackupCodes();
    freshUser.security.backupCodes = hashedCodes;

    await this.userSecurityRepository.save(freshUser.security);
    await this.userCacheService.clearUserSession(user.id);

    return { messageKey: 'AUTH.2FA_ENABLED_SUCCESSFULLY', backupCodes: codes };
  }

  async disableTwoFactor(user: UserIdentity) {
      const freshUser = await this.userRepository.findOne({
        where: { id: user.id },
        relations: ['security']
      });

      if (freshUser && freshUser.security) {
          // Use update to force nulls/false
          // `update`, not `save`: this is a partial write of explicit nulls, which is exactly
          // what `save`'s DeepPartial type refuses — and `save` would also have re-inserted the
          // fields it was not given.
          await this.userSecurityRepository.update(freshUser.security.id, {
              isTwoFactorEnabled: false,
              twoFactorSecret: null,
              // Clear the staged secret too, otherwise a stale enrolment started earlier could
              // be confirmed after the user had deliberately turned 2FA off.
              pendingTwoFactorSecret: null,
              lastTotpStep: null,
              backupCodes: null
          });
      }

      await this.userCacheService.clearUserSession(user.id);
      return { messageKey: 'AUTH.2FA_DISABLED_SUCCESSFULLY' };
  }

  // 10/10 SECURITY: Backup Codes Management
  async generateBackupCodes(user: UserIdentity) {
      const security = await this.ensureSecurityEntity(user);

      if (!security.isTwoFactorEnabled) {
          throw new BadRequestError('AUTH.CANNOT_GENERATE_BACKUP_CODES_IF_2FA_NOT');
      }

      const { codes, hashedCodes } = await this.createBackupCodes();

      security.backupCodes = hashedCodes;
      await this.userSecurityRepository.save(security);

      return { codes };
  }

  async verifyBackupCode(user: UserIdentity, code: string): Promise<boolean> {
      const security = user.security || (await this.ensureSecurityEntity(user));

      if (!security.backupCodes || security.backupCodes.length === 0) {
          return false;
      }

      // Check against all hashed codes
      // This is O(N) where N is small (e.g., 10). Acceptable.
      for (const hashedCode of security.backupCodes) {
          // The arguments were previously swapped (verify(code, hashedCode)). PasswordService's
          // signature is verify(hash, plain), so argon2 received the plaintext code where it
          // expected an encoded hash, failed to parse it, and threw — meaning backup codes never
          // worked at all and surfaced as a 500 rather than "invalid code".
          if (await this.passwordService.verify(hashedCode, code)) {
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
          hashedCodes.push(await this.passwordService.hash(formattedCode));
      }

      return { codes, hashedCodes };
  }

  private async ensureSecurityEntity(user: UserIdentity): Promise<UserSecurity> {
      const security = user.security;

      if (!security) {
          const freshUser = await this.userRepository.findOne({ where: { id: user.id }, relations: ['security'] });
          if (!freshUser) throw new UnauthorizedError('AUTH.USER_NOT_FOUND');
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
