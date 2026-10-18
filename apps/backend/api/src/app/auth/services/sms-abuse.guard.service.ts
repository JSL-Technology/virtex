import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { ForbiddenError, ServiceUnavailableError, TooManyRequestsError } from '../../i18n/localized.exception';

/**
 * Fraud controls for outbound SMS.
 *
 * `POST /auth/send-public-verification` is unauthenticated by necessity — the caller is signing
 * up and has no account yet — and it sends a message to any number in the request body. That is
 * the exact shape of SMS pumping: an operator controlling premium-rate ranges drives traffic to
 * numbers they are paid for, and the victim is whoever holds the Twilio account. reCAPTCHA and a
 * per-IP rate limit do not stop it, because the attacker rotates IPs and solves the challenge;
 * what stops it is refusing destinations that make no commercial sense and capping what a single
 * campaign can cost.
 *
 * Four controls, applied in order of cheapness:
 *
 *   1. Country allow-list. The product sells in specific markets. A verification code to a
 *      country where nobody can buy it is, definitionally, not a legitimate signup.
 *   2. Per-number cap. A real person needs one code, and a resend or two. Not forty.
 *   3. Per-prefix velocity. Pumping concentrates on a narrow range of destinations; a legitimate
 *      signup pattern does not produce hundreds of messages to one carrier prefix in an hour.
 *   4. Global daily cap. The backstop that bounds the bill when the first three are evaded, and
 *      the one that turns an incident from an invoice into an alert.
 *
 * Every rejection is logged with the reason. What the CALLER is told depends on whether they can
 * act on it (QA A-10). The signup screen used to say "the SMS could not be sent, try again" for
 * all four, so a person who had simply asked for a code five times retried, failed, and left —
 * and a failed SMS is a lost signup. Now:
 *
 *   - the per-number cap says so, with the wait until the window reopens: it is the one a real
 *     person hits, and "try again in 40 minutes" is information they need, not a leak — the
 *     number is theirs and the cap is per number;
 *   - an unserved country says so: the number is outside the markets the product sells in, and
 *     no amount of retrying changes that;
 *   - the per-prefix and global caps answer "SMS is unavailable, verify by email": those are the
 *     anti-fraud controls proper, and naming them would tell a pumping operator which one fired.
 */
@Injectable()
export class SmsAbuseGuardService {
  private readonly logger = new Logger(SmsAbuseGuardService.name);

  /** Messages allowed to a single destination number within the window. */
  private static readonly PER_NUMBER_LIMIT = 5;
  private static readonly PER_NUMBER_WINDOW_MS = 60 * 60 * 1000;

  /** Messages allowed to one country + carrier prefix within the window. */
  private static readonly PER_PREFIX_LIMIT = 100;
  private static readonly PER_PREFIX_WINDOW_MS = 60 * 60 * 1000;

  /** Platform-wide daily ceiling. Sized to be far above normal traffic and far below a bill. */
  private static readonly GLOBAL_DAILY_LIMIT_DEFAULT = 2_000;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly config: ConfigService,
  ) {}

  /**
   * Destinations the product actually sells to, as E.164 calling codes.
   *
   * Configured through `SMS_ALLOWED_COUNTRY_CODES` so opening a new market is a deployment
   * change, not a release. The default covers the markets the fiscal regions support.
   */
  private allowedCallingCodes(): string[] {
    const configured = this.config.get<string>('SMS_ALLOWED_COUNTRY_CODES');
    if (configured?.trim()) {
      return configured
        .split(',')
        .map((code) => code.trim().replace(/^\+/, ''))
        .filter(Boolean);
    }

    return [
      '1', // US, Canada, Dominican Republic, Puerto Rico (NANP)
      '52', // Mexico
      '57', // Colombia
      '56', // Chile
      '51', // Peru
      '507', // Panama
      '506', // Costa Rica
      '54', // Argentina
      '55', // Brazil
      '593', // Ecuador
      '598', // Uruguay
      '595', // Paraguay
      '591', // Bolivia
      '502', // Guatemala
      '503', // El Salvador
      '504', // Honduras
      '505', // Nicaragua
      '58', // Venezuela
    ];
  }

  private globalDailyLimit(): number {
    return this.config.get<number>('SMS_GLOBAL_DAILY_LIMIT', SmsAbuseGuardService.GLOBAL_DAILY_LIMIT_DEFAULT);
  }

  /**
   * Approve one outbound verification SMS, or refuse it.
   *
   * @param phoneNumber Destination in E.164 form (`+` followed by digits).
   * @throws ForbiddenException with a message that reveals nothing about which control fired.
   */
  async assertMaySend(phoneNumber: string): Promise<void> {
    const e164 = phoneNumber.replace(/[^\d+]/g, '');
    const digits = e164.replace(/^\+/, '');

    const callingCode = this.allowedCallingCodes()
      // Longest match first: '507' must win over '5' if both were ever listed.
      .sort((a, b) => b.length - a.length)
      .find((code) => digits.startsWith(code));

    if (!callingCode) {
      this.reject('country_not_served', { digits });
    }

    // Country code plus the next three digits: enough to identify a carrier range, not enough to
    // be a subscriber number in a log.
    const prefix = digits.slice(0, callingCode!.length + 3);

    await this.assertUnderLimit(
      `sms:number:${this.hash(digits)}`,
      SmsAbuseGuardService.PER_NUMBER_LIMIT,
      SmsAbuseGuardService.PER_NUMBER_WINDOW_MS,
      'per_number_limit',
      { callingCode },
    );

    await this.assertUnderLimit(
      `sms:prefix:${prefix}`,
      SmsAbuseGuardService.PER_PREFIX_LIMIT,
      SmsAbuseGuardService.PER_PREFIX_WINDOW_MS,
      'per_prefix_limit',
      { prefix },
    );

    await this.assertUnderLimit(
      `sms:global:${new Date().toISOString().slice(0, 10)}`,
      this.globalDailyLimit(),
      24 * 60 * 60 * 1000,
      'global_daily_limit',
      {},
    );
  }

  /**
   * Increment a counter and refuse once it passes its limit.
   *
   * The counter is incremented BEFORE the decision, so a burst of concurrent requests cannot all
   * observe the same low value and all proceed. The window is FIXED from the first message — the
   * entry carries when it opened — so the refusal can say how long until it reopens, and a person
   * who keeps retrying does not push that moment further away.
   */
  private async assertUnderLimit(
    key: string,
    limit: number,
    windowMs: number,
    reason: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    let current: number;
    let resetAt: number;
    try {
      const stored = await this.cache.get<number | { count: number; resetAt: number }>(key);
      const now = Date.now();
      // A bare number is an entry written before the window carried its own end.
      const entry =
        typeof stored === 'number'
          ? { count: stored, resetAt: now + windowMs }
          : stored && stored.resetAt > now
            ? stored
            : { count: 0, resetAt: now + windowMs };
      current = entry.count + 1;
      resetAt = entry.resetAt;
      await this.cache.set(key, { count: current, resetAt }, Math.max(1000, resetAt - now));
    } catch (error) {
      // Fail CLOSED. These counters ARE the fraud control; a cache outage that made
      // `get` throw would otherwise reset every one of them to zero on every call and
      // silently disable all four limits at once — precisely when an attacker is
      // hammering the endpoint hard enough to be the cause of the outage. Refusing to
      // send costs a few legitimate signups an SMS for the duration; failing open costs
      // an unbounded Twilio invoice.
      this.logger.error(
        { event: 'sms_budget_unavailable', reason: (error as Error).message },
        '[SECURITY] SMS abuse counters are unavailable; refusing to send.',
      );
      throw new ServiceUnavailableError('auth.sms_unavailable_use_email');
    }

    if (current > limit) {
      this.reject(reason, { ...context, count: current, limit }, resetAt);
    }
  }

  private reject(reason: string, context: Record<string, unknown>, resetAt?: number): never {
    this.logger.warn(
      { event: 'sms_send_refused', reason, ...context },
      '[SECURITY] Outbound verification SMS refused',
    );

    if (reason === 'per_number_limit' && resetAt) {
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      throw new TooManyRequestsError(
        'auth.sms_number_limit_reached',
        { retryAfterSeconds, minutes: Math.max(1, Math.ceil(retryAfterSeconds / 60)) },
        'SMS_NUMBER_LIMIT',
      );
    }
    if (reason === 'country_not_served') {
      throw new ForbiddenError('auth.verification_code_could_not_sent_number', {}, 'SMS_COUNTRY_NOT_SUPPORTED');
    }
    // The anti-fraud caps proper: say only that SMS is not available right now.
    throw new ServiceUnavailableError('auth.sms_unavailable_use_email', {}, 'SMS_UNAVAILABLE');
  }

  /** Destination numbers are personal data; count them without storing them. */
  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
  }
}
