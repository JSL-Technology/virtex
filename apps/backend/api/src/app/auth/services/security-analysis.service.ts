import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import * as Bowser from 'bowser';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GeoService } from '../../geo/geo.service';
import { AuditTrailService } from '../../audit/audit.service';
import { AuthConfig } from '../auth.config';
import { User } from '../../users/entities/user.entity/user.entity';
import { VerificationCode, VerificationType } from '../entities/verification-code.entity';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { UsersService } from '../../users/users.service';
import { TwoFactorAuthService } from './two-factor-auth.service';

@Injectable()
export class SecurityAnalysisService {
  private readonly logger = new Logger(SecurityAnalysisService.name);

  constructor(
    private readonly geoService: GeoService,
    private readonly auditService: AuditTrailService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @InjectRepository(VerificationCode)
    private readonly verificationCodeRepository: Repository<VerificationCode>,
    @InjectRepository(UserSecurity)
    private readonly userSecurityRepository: Repository<UserSecurity>,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => TwoFactorAuthService))
    private readonly twoFactorAuthService: TwoFactorAuthService,
  ) {}

  /**
   * Checks for "Impossible Travel" anomalies based on the user's last login IP.
   * Emits a 'security.suspicious_travel' event when suspicious speed is detected,
   * rather than blocking login — avoids false positives from VPN or flights.
   */
  async checkImpossibleTravel(userId: string, currentIp?: string): Promise<void> {
    if (!currentIp || !userId) return;

    const lastLogin = await this.auditService.getLastLogin(userId);
    if (!lastLogin || !lastLogin.ipAddress) return;

    if (lastLogin.ipAddress === currentIp) return;

    const currentLocation = this.geoService.getLocation(currentIp);
    const lastLocation = this.geoService.getLocation(lastLogin.ipAddress);

    if (currentLocation.ll && lastLocation.ll) {
      const [currentLat, currentLon] = currentLocation.ll;
      const [lastLat, lastLon] = lastLocation.ll;

      const distanceKm = this.geoService.calculateDistance(lastLat, lastLon, currentLat, currentLon);
      const timeDiffHours = (Date.now() - lastLogin.timestamp.getTime()) / (1000 * 60 * 60);

      // Avoid division by zero
      const safeTimeDiff = timeDiffHours < 0.01 ? 0.01 : timeDiffHours;

      const speed = distanceKm / safeTimeDiff;

      const maxSpeed = AuthConfig.IMPOSSIBLE_TRAVEL_MAX_SPEED;
      const minDistance = AuthConfig.IMPOSSIBLE_TRAVEL_MIN_DISTANCE;

      if (distanceKm > minDistance && speed > maxSpeed) {
        this.logger.warn(
          `[SECURITY] Suspicious travel detected for user ${userId}. ` +
          `Distance: ${distanceKm.toFixed(2)} km, Time: ${timeDiffHours.toFixed(2)} h, Speed: ${speed.toFixed(2)} km/h.`,
        );
        this.eventEmitter.emit('security.suspicious_travel', {
          userId,
          speed: speed.toFixed(2),
          distanceKm: distanceKm.toFixed(2),
          previousIp: lastLogin.ipAddress,
          currentIp,
        });
      }
    }
  }

  /**
   * Validates a 2FA code (TOTP or SMS).
   *
   * TOTP verification is delegated to `TwoFactorAuthService.verifyCode`, which burns the accepted
   * time-step. This method used to call `authenticator.verify()` directly, so the login path had
   * NO replay protection while the step-up path did — two implementations of the same check with
   * different security properties, and the weaker one on the more exposed route.
   *
   * What that allowed, concretely: a code observed once (a phishing proxy, a shoulder-surf, an
   * infostealer reading the authenticator screen) stayed usable for the remainder of its 30-second
   * step at `POST /auth/login`; and because the login path never advanced `last_totp_step`, the
   * same six digits could then be spent AGAIN to authorise a step-up action. It also made
   * `AUTH_TOTP_WINDOW` dead configuration here, since `authenticator.verify` defaults to a window
   * of zero and the drift tolerance operators had configured simply did not apply.
   * (NIST SP 800-63B §5.1.4.2: the verifier shall reject an already-used OTP.)
   */
  async validateTwoFactorCode(user: User, code: string): Promise<boolean> {
    let isValid2FA = false;

    // 1. Try TOTP (Authenticator App) if secret exists
    if (user.security?.twoFactorSecret) {
      isValid2FA = await this.twoFactorAuthService.verifyCode(user, code);
    }

    // 2. If not valid via TOTP, try SMS OTP (if verification code exists)
    if (!isValid2FA) {
      const record = await this.verificationCodeRepository.findOne({
        where: { userId: user.id, type: VerificationType.LOGIN_2FA },
      });

      if (record && new Date() <= record.expiresAt) {
        // H-08 FIX: Track attempts for LOGIN_2FA codes, mirroring the same brute-force
        // protection applied to email/phone OTPs (NIST SP 800-63B §5.2.2; OWASP ASVS
        // 2.2.4; CWE-307). Throttle guard is a coarse defence; per-challenge counter
        // is the fine-grained one.
        record.attempts = (record.attempts ?? 0) + 1;
        record.lastAttemptAt = new Date();

        if (record.attempts > 5) {
          await this.verificationCodeRepository.delete(record.id);
          return false; // Caller (mfa-orchestrator) will throw UnauthorizedException
        }

        await this.verificationCodeRepository.save(record);

        isValid2FA = await argon2.verify(record.code, code);
        if (isValid2FA) {
          await this.verificationCodeRepository.delete(record.id);
        }
      }
    }

    return isValid2FA;
  }

  /**
   * Lightweight User Agent Parser.
   * Uses 'bowser' (MIT) to safely parse user agent strings.
   * Returns generic names for fuzzy matching (e.g. 'Chrome' instead of 'Chrome 120.0.1')
   */
  parseUserAgent(userAgent: string): { browser: string; os: string; deviceType: string } {
    if (!userAgent) return { browser: 'Unknown', os: 'Unknown', deviceType: 'Unknown' };

    try {
      const parsed = Bowser.parse(userAgent);
      // We explicitly ignore version numbers for fuzzy matching to avoid false positives on auto-updates
      // I-15 FIX: also return deviceType (desktop/mobile/tablet) so refresh_tokens.device_type
      // is populated instead of always being null.
      return {
        browser: parsed.browser.name || 'Unknown',
        os: parsed.os.name || 'Unknown',
        deviceType: parsed.platform?.type || 'Unknown',
      };
    } catch (error) {
      this.logger.warn(`Failed to parse User Agent: ${userAgent}`);
      return { browser: 'Unknown', os: 'Unknown', deviceType: 'Unknown' };
    }
  }

  /**
   * Count one failed authentication attempt and lock the account once the budget is spent.
   *
   * The increment is done by the DATABASE, not by reading a value into memory and writing back
   * `value + 1`. The read-modify-write version lost increments under exactly the conditions the
   * counter exists for: a credential-stuffing run fires attempts in parallel, every one of them
   * reads the same count, and they all write the same number — so a burst of fifty guesses could
   * register as one. Worse, `usersService.save(user)` persisted the whole entity graph, so two
   * concurrent failures could also clobber unrelated fields of `user_security`.
   *
   * A single UPDATE with `failed_login_attempts = failed_login_attempts + 1` is atomic per row,
   * and the lockout is applied in the same statement so there is no window between passing the
   * threshold and being locked.
   */
  async handleFailedLoginAttempt(user: User) {
    if (!user.security) return;

    const maxAttempts = AuthConfig.MAX_FAILED_ATTEMPTS;
    const lockoutMs = AuthConfig.LOCKOUT_DURATION;

    const [updated] = await this.userSecurityRepository.query(
      `
      UPDATE "user_security"
         SET "failed_login_attempts" = "failed_login_attempts" + 1,
             "lockout_until" = CASE
               WHEN "failed_login_attempts" + 1 >= $2 THEN now() + ($3 || ' milliseconds')::interval
               ELSE "lockout_until"
             END
       WHERE "id" = $1
       RETURNING "failed_login_attempts", "lockout_until"
      `,
      [user.security.id, maxAttempts, String(lockoutMs)],
    );

    // Keep the in-memory copy consistent with what the row now holds, so a caller that inspects
    // it after this call (the login path reports lockout state) does not see a stale value.
    if (updated) {
      user.security.failedLoginAttempts = Number(updated.failed_login_attempts);
      user.security.lockoutUntil = updated.lockout_until ? new Date(updated.lockout_until) : null;
    }
  }

  async resetLoginAttempts(user: User) {
    if (user.security && (user.security.failedLoginAttempts > 0 || user.security.lockoutUntil)) {
      user.security.failedLoginAttempts = 0;
      user.security.lockoutUntil = null;
      await this.usersService.save(user);
    }
  }
}
