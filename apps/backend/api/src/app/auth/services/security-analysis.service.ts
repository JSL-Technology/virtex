import { Injectable, Logger, UnauthorizedException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { authenticator } from 'otplib';
import * as argon2 from 'argon2';
import * as Bowser from 'bowser';
import { GeoService } from '../../geo/geo.service';
import { AuditTrailService } from '../../audit/audit.service';
import { AuthConfig } from '../auth.config';
import { User } from '../../users/entities/user.entity/user.entity';
import { VerificationCode, VerificationType } from '../entities/verification-code.entity';
import { CryptoUtil } from '../../shared/utils/crypto.util';
import { UsersService } from '../../users/users.service';

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
    private readonly cryptoUtil: CryptoUtil
  ) {}

  /**
   * Checks for "Impossible Travel" anomalies based on the user's last login IP.
   * Throws UnauthorizedException if travel speed exceeds reasonable limits.
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
          `[SECURITY] Impossible Travel Detected for User ${userId}. Distance: ${distanceKm.toFixed(
            2
          )}km, Time: ${timeDiffHours.toFixed(2)}h, Speed: ${speed.toFixed(2)}km/h. Previous IP: ${
            lastLogin.ipAddress
          }, Current IP: ${currentIp}`
        );
        throw new UnauthorizedException(
          'Viaje imposible detectado. Por seguridad, su cuenta ha sido bloqueada temporalmente. Contacte a soporte.'
        );
      }
    }
  }

  /**
   * Validates a 2FA code (TOTP or SMS).
   */
  async validateTwoFactorCode(user: User, code: string): Promise<boolean> {
    let isValid2FA = false;

    // 1. Try TOTP (Authenticator App) if secret exists
    if (user.security && user.security.twoFactorSecret) {
      const decryptedSecret = this.cryptoUtil.decrypt(user.security.twoFactorSecret);
      try {
        isValid2FA = authenticator.verify({
          token: code,
          secret: decryptedSecret,
        });
      } catch (e) {
        this.logger.error(`TOTP Verification Error for user ${user.id}: ${(e as Error).message}`);
      }
    }

    // 2. If not valid via TOTP, try SMS OTP (if verification code exists)
    if (!isValid2FA) {
      const record = await this.verificationCodeRepository.findOne({
        where: { userId: user.id, type: VerificationType.LOGIN_2FA },
      });

      if (record && new Date() <= record.expiresAt) {
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
  parseUserAgent(userAgent: string): { browser: string; os: string } {
    if (!userAgent) return { browser: 'Unknown', os: 'Unknown' };

    try {
      const parsed = Bowser.parse(userAgent);
      // We explicitly ignore version numbers for fuzzy matching to avoid false positives on auto-updates
      return {
        browser: parsed.browser.name || 'Unknown',
        os: parsed.os.name || 'Unknown',
      };
    } catch (error) {
      this.logger.warn(`Failed to parse User Agent: ${userAgent}`);
      return { browser: 'Unknown', os: 'Unknown' };
    }
  }

  async handleFailedLoginAttempt(user: User) {
    if (!user.security) return;

    const MAX_FAILED_ATTEMPTS = AuthConfig.MAX_FAILED_ATTEMPTS;
    // LOCKOUT_DURATION is in ms
    const lockoutMs = AuthConfig.LOCKOUT_DURATION;

    user.security.failedLoginAttempts = (user.security.failedLoginAttempts || 0) + 1;

    if (user.security.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockoutTime = new Date(Date.now() + lockoutMs);
      user.security.lockoutUntil = lockoutTime;
    }

    await this.usersService.save(user);
  }

  async resetLoginAttempts(user: User) {
    if (user.security && (user.security.failedLoginAttempts > 0 || user.security.lockoutUntil)) {
      user.security.failedLoginAttempts = 0;
      user.security.lockoutUntil = null;
      await this.usersService.save(user);
    }
  }
}
