import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { User } from '../../users/entities/user.entity/user.entity';
import { MailService } from '../../mail/mail.service';
import { UserCacheService } from '../modules/user-cache.service';
import { UnauthorizedError } from '../../i18n/localized.exception';
import { returnedRows } from '../../shared/database/returned-rows';

/** How long an unlock link stays usable. Longer than the lockout: it is read when it is read. */
const UNLOCK_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * At most one lockout email per account per window.
 *
 * The email goes out when the lock engages and again when the owner tries the right password
 * while it is still on. Somebody hammering the form with the right password — the owner,
 * impatient — must not turn that into an inbox flood, and each send rotates the token, so a burst
 * would also leave only the last link working.
 */
const NOTICE_COOLDOWN_MS = 5 * 60 * 1000;

/** SHA-256 of a 256-bit random token — the same reasoning as `hashOpaqueToken` for resets. */
function hashToken(token: string): string {
  // codeql[js/insufficient-password-hash] The input is a 256-bit random token, not a password.
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Getting back into a locked account without waiting for the window to run out (QA C-09).
 *
 * The lockout itself is unchanged — `SecurityAnalysisService` engages it after too many failed
 * sign-ins. What was missing is the owner's side: they were told nothing (the reply was "wrong
 * email or password" even with the right one), received nothing, and could do nothing but wait
 * or reset a password that was never the problem.
 *
 * Now the owner gets an email at the address on the account, with a single-use link. Following
 * it clears the lockout and the failed-attempt count. It does NOT sign anybody in and does not
 * change the password: it only gives the owner their attempts back, which is exactly what waiting
 * would have done, sooner. If the lock was somebody else guessing, the email says so and points to
 * a password reset.
 */
@Injectable()
export class AccountUnlockService {
  private readonly logger = new Logger(AccountUnlockService.name);

  constructor(
    @InjectRepository(UserSecurity) private readonly securityRepository: Repository<UserSecurity>,
    private readonly mailService: MailService,
    private readonly userCacheService: UserCacheService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** Whole minutes until the lockout ends, never less than one while it is on. */
  static minutesRemaining(lockoutUntil: Date | null | undefined, now = new Date()): number {
    if (!lockoutUntil) return 0;
    const ms = lockoutUntil.getTime() - now.getTime();
    return ms <= 0 ? 0 : Math.max(1, Math.ceil(ms / 60_000));
  }

  /**
   * Email the owner a fresh unlock link, unless one went out a moment ago.
   *
   * Never throws: a mail outage must not change what the sign-in answers. The failure is logged
   * for the operator, and the lockout still expires on its own.
   */
  async notifyLocked(user: User, options: { force?: boolean } = {}): Promise<void> {
    if (!user.security?.id || !user.email) return;
    const cooldownKey = `account-unlock-notice:${user.id}`;
    try {
      if (!options.force && (await this.cache.get(cooldownKey))) return;
      await this.cache.set(cooldownKey, 1, NOTICE_COOLDOWN_MS);

      const rawToken = crypto.randomBytes(32).toString('base64url');
      await this.securityRepository.update(
        { id: user.security.id },
        { unlockToken: hashToken(rawToken), unlockTokenExpires: new Date(Date.now() + UNLOCK_LINK_TTL_MS) },
      );

      await this.mailService.sendAccountLockedEmail(
        user,
        rawToken,
        AccountUnlockService.minutesRemaining(user.security.lockoutUntil) || 1,
        Math.round(UNLOCK_LINK_TTL_MS / 3_600_000),
      );
    } catch (error) {
      this.logger.error(
        { event: 'account_unlock_notice_failed', userId: user.id },
        `Could not send the lockout notice: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Redeem an unlock link.
   *
   * One conditional UPDATE: it matches the hashed token only while unexpired, clears the lockout,
   * the counter and the token together, and reports whether a row changed. Replaying the link —
   * or racing two tabs — finds nothing the second time.
   */
  async unlock(token: string): Promise<void> {
    if (!token || token.length > 256) {
      throw new UnauthorizedError('auth.unlock_link_invalid_or_expired');
    }
    const [row] = returnedRows<{ user_id: string }>(
      await this.securityRepository.query(
        `
        UPDATE "user_security"
           SET "failed_login_attempts" = 0,
               "lockout_until" = NULL,
               "unlock_token" = NULL,
               "unlock_token_expires" = NULL
         WHERE "unlock_token" = $1
           AND "unlock_token_expires" > now()
         RETURNING "user_id"
        `,
        [hashToken(token)],
      ),
    );
    const userId = row?.user_id;
    if (!userId) {
      throw new UnauthorizedError('auth.unlock_link_invalid_or_expired');
    }

    // The principal is cached with its security state; drop it so the next sign-in reads the row.
    await this.userCacheService.clearUserSession(userId);
    this.logger.log({ event: 'account_unlocked_by_link', userId }, 'Account unlocked from the emailed link.');
  }
}
