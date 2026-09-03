import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { DEFAULT_LANGUAGE, LanguageCode, matchLanguage } from '@virteex/shared/types';
import { User } from '../users/entities/user.entity/user.entity';
import { currentLanguage } from '../i18n/request-locale';
import { FrontendUrlService } from './frontend-url.service';
import { MAIL_JOB_OPTIONS, MAIL_QUEUE, MailJob } from './mail.queue';

/**
 * Transactional email, enqueued rather than sent inline.
 *
 * Every method here used to `await mailerService.sendMail(...)` directly, with no try/catch
 * anywhere in the class. That put an SMTP round trip on the request thread, gave a transient
 * failure no second chance, and — in `UsersService.inviteUser`, which sent inside its database
 * transaction — let an unreachable mail server roll back the user it had just created.
 *
 * The public surface is unchanged; what changed is that the promise now resolves when the job is
 * durably queued, and `MailProcessor` does the delivery with retries and backoff.
 *
 * ## Language
 *
 * Every subject was a Spanish literal written here, and every template declared `<html lang="es">`
 * — while the LINK inside the body was built from `user.preferredLanguage`, so an English-speaking
 * customer received a Spanish email pointing at an English page. `sendPasswordResetEmail` did both
 * of those things four lines apart.
 *
 * Now the subject travels as a key and the language travels with the job, resolved from the
 * RECIPIENT and not from whoever triggered the send: an administrator inviting a colleague sends
 * the invitation in the colleague's language.
 *
 * A recipient with no stored preference falls back to the language of the request that caused the
 * email — which, for a signup or a password reset, is the language the person was actually
 * reading a moment ago, and is a far better guess than a global default.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue<MailJob>,
    private readonly configService: ConfigService,
    // Every link into the web client goes through this. Built inline at each call site, they
    // were all pointing at routes that do not exist — see FrontendUrlService for the list.
    private readonly links: FrontendUrlService,
  ) {}

  /**
   * Hand one email to the queue.
   *
   * Throws when the job cannot be queued at all — that is a Redis outage, not a mail problem, and
   * the callers that must know (signup verification, password reset) still find out. What no
   * longer reaches them is an SMTP failure, which is the queue's business.
   */
  private async enqueue(job: MailJob): Promise<void> {
    await this.mailQueue.add(job.template, job, MAIL_JOB_OPTIONS);
  }

  /**
   * The language one email is written in.
   *
   * The recipient's stored preference when they have one; otherwise the language of the request
   * that triggered the send, which is what the person was reading a moment ago. Falls back to the
   * default only outside a request — a scheduled job, a webhook.
   */
  private languageFor(recipient?: { preferredLanguage?: string | null } | null): LanguageCode {
    return matchLanguage(recipient?.preferredLanguage) ?? currentLanguage() ?? DEFAULT_LANGUAGE;
  }

  /** The product name, from configuration, so it is one value rather than a literal per email. */
  private get appName(): string {
    return this.configService.get<string>('APP_NAME', 'Virtex');
  }

  /**
   * Common context every template needs.
   *
   * `logoUrl` and `appUrl` are here rather than in each template because the header lives in the
   * shared `shell` partial: leaving them to the caller is how the old templates ended up shipping
   * `<img src="">` and `<a href="">` — a broken image and a link to nowhere, in production.
   */
  private baseContext(): Record<string, unknown> {
    return {
      appName: this.appName,
      currentYear: new Date().getFullYear(),
      appUrl: this.links.home(),
      logoUrl: this.links.brandTile(),
    };
  }

  async sendPasswordResetEmail(user: User, token: string, expiration: string) {
    const language = this.languageFor(user);

    await this.enqueue({
      to: user.email,
      subjectKey: 'MAIL.PASSWORD_RESET.SUBJECT',
      language,
      template: 'password-reset',
      context: {
        ...this.baseContext(),
        name: user.firstName,
        resetLink: this.links.passwordReset(token, language),
        // The duration travels as a count and a unit key, so the template pluralises through
        // CLDR. It used to be built here as `${value} minuto${value > 1 ? 's' : ''}` — Spanish
        // grammar written into TypeScript, and wrong for 1.5 in any language.
        expiration: this.parseDuration(expiration),
      },
    });
  }

  /**
   * `'15m'` → `{ count: 15, unitKey: 'TIME.MINUTES' }`, which the template pluralises through
   * CLDR in the reader's language.
   *
   * Always returns both fields. The mail templates run with Handlebars `strict: true`, which
   * throws on a missing property rather than rendering an empty string, so an unparseable value
   * must still produce something renderable — `TIME.UNSPECIFIED` says "a limited time", which is
   * true, rather than inventing a number that is not.
   */
  private parseDuration(time: string): { count: number; unitKey: string } {
    const unitKey =
      typeof time === 'string' && time.length >= 2
        ? { m: 'TIME.MINUTES', h: 'TIME.HOURS', d: 'TIME.DAYS' }[time.slice(-1).toLowerCase()]
        : undefined;
    const count = Number.parseInt(String(time).slice(0, -1), 10);

    if (!unitKey || Number.isNaN(count)) {
      this.logger.warn(`Unparseable link expiry "${time}"; the email will not name a duration.`);
      return { count: 0, unitKey: 'TIME.UNSPECIFIED' };
    }
    return { count, unitKey };
  }

  async sendUserInvitation(user: User, token: string) {
    const language = this.languageFor(user);

    await this.enqueue({
      to: user.email,
      subjectKey: 'MAIL.INVITATION.SUBJECT',
      subjectParams: { appName: this.appName },
      language,
      template: 'user-invitation',
      context: {
        ...this.baseContext(),
        name: user.firstName,
        // Was `?token=` while the page reads only `#token=`, so the invitation arrived without one.
        url: this.links.setPasswordFromInvitation(token, language),
      },
    });
  }

  /**
   * Tell somebody who already has an account that they now have access to another tenant.
   *
   * Distinct from `sendUserInvitation` on purpose: that one carries a set-your-password link, and
   * sending it to a person who already has a password is both confusing and a nudge towards
   * changing a credential they never asked to change. This one points at sign-in and says which
   * organization added them.
   */
  async sendAddedToOrganizationEmail(user: User, organizationName: string) {
    const language = this.languageFor(user);

    await this.enqueue({
      to: user.email,
      subjectKey: 'MAIL.ORGANIZATION_ADDED.SUBJECT',
      subjectParams: { organization: organizationName },
      language,
      template: 'organization-added',
      context: {
        ...this.baseContext(),
        name: user.firstName,
        organizationName,
        url: this.links.login(undefined, language),
      },
    });
  }

  /**
   * Somebody tried to sign up with an address that already has an account.
   *
   * The account exists, so its owner's preference is knowable — but this method is reached from
   * the public signup form, which deliberately does not load the user (telling the caller whether
   * an address exists is the enumeration leak this email exists to avoid). The request language is
   * the right answer here: it is the language the person filling in the form was reading.
   */
  async sendDuplicateRegistrationEmail(email: string, name: string) {
    const language = this.languageFor(null);

    await this.enqueue({
      to: email,
      subjectKey: 'MAIL.DUPLICATE_REGISTRATION.SUBJECT',
      language,
      template: 'duplicate-registration',
      context: {
        ...this.baseContext(),
        name,
        loginUrl: this.links.login(undefined, language),
        resetPasswordUrl: this.links.forgotPassword(language),
      },
    });
  }

  /**
   * Tell somebody their payment went through but their account could not be created.
   *
   * Payment-first signup means the charge happens before the account exists, so this failure
   * leaves a real customer with a real charge and nothing to show for it. Silence was the
   * previous behaviour and it is the worst one: the screen told them to "sign in in a few
   * minutes" to an account that does not exist, with no reference to quote to support.
   */
  async sendRegistrationFailedEmail(email: string, name: string, reference: string) {
    const language = this.languageFor(null);

    await this.enqueue({
      to: email,
      subjectKey: 'MAIL.REGISTRATION_FAILED.SUBJECT',
      language,
      template: 'registration-failed',
      context: {
        ...this.baseContext(),
        name,
        registerUrl: this.links.register(language),
        reference,
      },
    });
  }

  async sendVerificationCodeEmail(email: string, code: string, name: string) {
    await this.enqueue({
      to: email,
      subjectKey: 'MAIL.VERIFICATION_CODE.SUBJECT',
      language: this.languageFor(null),
      template: 'verification-code',
      context: { ...this.baseContext(), name, code },
    });
  }

  // H-01 FIX: Sends a confirmation link to the *new* address before the change is applied.
  // The token is a 32-byte hex nonce — SHA-256 hash is stored in DB, raw value in link.
  async sendEmailChangeConfirmation(newEmail: string, rawToken: string, firstName: string) {
    await this.enqueue({
      to: newEmail,
      subjectKey: 'MAIL.EMAIL_CHANGE.SUBJECT',
      language: this.languageFor(null),
      template: 'email-change-confirm',
      context: {
        ...this.baseContext(),
        name: firstName,
        confirmUrl: this.links.confirmEmailChange(rawToken),
        expiresMinutes: 15,
      },
    });
  }

  /**
   * Warn the address that is losing the account.
   *
   * The confirmation above goes to the NEW address, which is the wrong side for the case that
   * actually needs a signal: a hijacked session changing the email silently redirects account
   * recovery, and the legitimate owner learns nothing. The old address is the one channel the
   * attacker no longer controls at that point.
   */
  async sendEmailChangedNotice(previousEmail: string, firstName: string, newEmail: string) {
    await this.enqueue({
      to: previousEmail,
      subjectKey: 'MAIL.EMAIL_CHANGED_NOTICE.SUBJECT',
      language: this.languageFor(null),
      template: 'email-changed-notice',
      context: { ...this.baseContext(), name: firstName, newEmail },
    });
  }

  /**
   * A billing or quota notice, to everybody in the tenant who can act on it.
   *
   * One job per recipient rather than one job with many addresses: a bounce for one person must
   * not stop the others being told, BullMQ retries per job — and each of them reads in their own
   * language, which a single multi-recipient job could not do.
   */
  async sendBillingNotice(
    recipients: readonly { email: string; firstName?: string; preferredLanguage?: string | null }[],
    notice: { titleKey: string; bodyKey: string; params?: Record<string, unknown> },
  ): Promise<void> {
    const billingUrl = this.links.billing();

    for (const recipient of recipients) {
      await this.enqueue({
        to: recipient.email,
        subjectKey: notice.titleKey,
        subjectParams: notice.params,
        language: this.languageFor(recipient),
        template: 'billing-notice',
        context: {
          ...this.baseContext(),
          name: recipient.firstName,
          titleKey: notice.titleKey,
          bodyKey: notice.bodyKey,
          params: notice.params ?? {},
          billingUrl,
        },
      });
    }
  }

  /**
   * The welcome, sent once an account actually exists.
   *
   * Fired from `WelcomeEmailListener`, which holds it until the registration transaction commits:
   * a greeting for an account that rolled back is worse than no greeting at all.
   *
   * The organization's name travels with it because a customer can own several tenants, and
   * "your account is ready" without saying WHICH account is a question, not an answer.
   */
  async sendWelcomeEmail(user: User, organizationName: string) {
    const language = this.languageFor(user);

    await this.enqueue({
      to: user.email,
      subjectKey: 'MAIL.WELCOME.SUBJECT',
      subjectParams: { appName: this.appName },
      language,
      template: 'welcome',
      context: {
        ...this.baseContext(),
        name: user.firstName,
        organizationName,
        dashboardUrl: this.links.dashboard(),
      },
    });
  }

  async sendRegistrationEmailVerification(
    email: string,
    code: string,
    name: string,
    magicLinkUrl: string,
    expiresMinutes: number,
  ) {
    await this.enqueue({
      to: email,
      subjectKey: 'MAIL.REGISTRATION_VERIFY.SUBJECT',
      language: this.languageFor(null),
      template: 'registration-email-verify',
      context: { ...this.baseContext(), name, code, magicLinkUrl, expiresMinutes },
    });
  }
}
