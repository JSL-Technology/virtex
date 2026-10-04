import type { LanguageCode } from '@virteex/shared/types';

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
  /**
   * Catalogue key for the subject line, translated by `MailProcessor` at delivery.
   *
   * A key rather than a rendered string because the job may sit in Redis across a deploy, and
   * because the subject and the body must not be able to end up in different languages — which
   * is what happened when the subject was a Spanish literal in `MailService` and the link inside
   * the body was built for `/en/`.
   */
  subjectKey: string;
  /** Interpolation parameters for the subject. */
  subjectParams?: Record<string, unknown>;
  /**
   * The language this email is written in.
   *
   * The RECIPIENT's, resolved at the call site where the recipient is known — not the language
   * of whoever triggered the send. An administrator inviting a colleague sends the invitation in
   * the colleague's language, and a dunning notice goes to each person in theirs.
   */
  language: LanguageCode;
  /** Handlebars template name, as `@nestjs-modules/mailer` resolves it. */
  template: string;
  context: Record<string, unknown>;
  /**
   * Files to attach, base64-encoded so the job stays plain JSON in Redis. Kept small by the
   * callers (an invoice PDF is tens of kilobytes); anything large belongs in storage with a link.
   */
  attachments?: Array<{ filename: string; contentBase64: string; contentType: string }>;
  /**
   * The name shown as sender, for a document a company sends its own customer. The address stays
   * the platform's (`MAIL_FROM_ADDRESS`): that is the domain SPF and DKIM vouch for.
   */
  fromName?: string | null;
  /** Where the recipient's answer goes — the company, not the platform. */
  replyTo?: string | null;
  /** A blind copy for the sender's own records. */
  bcc?: string | null;
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
