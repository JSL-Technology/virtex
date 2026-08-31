/**
 * The outbound mail queue.
 *
 * Every transactional email used to be an awaited SMTP round trip on the request thread, with no
 * retry and no error handling anywhere in `MailService`. Three consequences, all of them real:
 *
 *   - a slow or unreachable SMTP server made the HTTP request slow or failed,
 *   - `UsersService.inviteUser` sent its invitation INSIDE the database transaction, so an SMTP
 *     failure rolled back the user that had just been created, and
 *   - a transient failure — the ordinary case for SMTP — lost the message permanently, including
 *     the password-reset link and the signup verification code.
 *
 * BullMQ gives it what a mail path needs: durability across a restart, exponential backoff, and a
 * failed job that stays visible instead of vanishing into a log line.
 */
export const MAIL_QUEUE = 'mail';

/** One email, described entirely by data so it survives serialisation into Redis. */
export interface MailJob {
  to: string;
  subject: string;
  /** Handlebars template name, as `@nestjs-modules/mailer` resolves it. */
  template: string;
  context: Record<string, unknown>;
}

/**
 * Retry policy.
 *
 * Five attempts over roughly ten minutes covers the failures SMTP actually has — a greylisting
 * delay, a brief DNS or TLS hiccup, a provider rate limit. Beyond that the address or the
 * configuration is wrong, and retrying is noise: the job is kept (`removeOnFail: false`) so it can
 * be inspected rather than guessed at.
 */
export const MAIL_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: false,
};
