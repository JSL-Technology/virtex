import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { createHash } from 'crypto';
import { I18nService } from '../i18n/i18n.service';
import { MAIL_QUEUE, MailJob } from './mail.queue';

/**
 * The only place an email is actually handed to SMTP.
 *
 * Failures are rethrown so BullMQ retries with backoff; the log line carries a hash of the
 * recipient rather than the address itself, because a mail log is one of the easiest places for
 * an address list to leak out of a system that is otherwise careful with PII.
 */
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly i18n: I18nService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  /**
   * The sender for a job that names one: that display name on the platform's address. A quote or
   * angle bracket in a company name would otherwise end the display name early and let the rest
   * read as an address.
   */
  private fromFor(name: string | null | undefined): string | undefined {
    const clean = name?.replace(/["<>\\\r\n]/g, '').trim();
    const address = this.config.get<string>('MAIL_FROM_ADDRESS');
    if (!clean || !address) return undefined;
    return `"${clean}" <${address}>`;
  }

  private recipientHash(to: string): string {
    return createHash('sha256').update(to.toLowerCase().trim()).digest('hex').slice(0, 12);
  }

  async process(job: Job<MailJob>): Promise<void> {
    const { to, subjectKey, subjectParams, language, template, context, attachments, fromName, replyTo, bcc } = job.data;
    const from = this.fromFor(fromName);

    // Subject and body are translated from the same `language`, at the same moment, so they
    // cannot disagree. They used to: the subject was a Spanish literal written in `MailService`
    // while the link inside the body was built for the recipient's own language segment, so an
    // English-speaking customer got a Spanish subject pointing at an English page.
    const subject = this.i18n.translate(subjectKey, language, subjectParams ?? {});

    try {
      await this.mailerService.sendMail({
        to,
        subject,
        ...(from ? { from } : {}),
        ...(replyTo ? { replyTo } : {}),
        ...(bcc ? { bcc } : {}),
        template,
        context: { ...context, language },
        ...(attachments?.length
          ? {
              attachments: attachments.map((file) => ({
                filename: file.filename,
                content: Buffer.from(file.contentBase64, 'base64'),
                contentType: file.contentType,
              })),
            }
          : {}),
      });
      this.logger.log(
        { event: 'mail_sent', template, recipientHash: this.recipientHash(to) },
        'Transactional email delivered.',
      );
    } catch (error) {
      this.logger.warn(
        {
          event: 'mail_delivery_failed',
          template,
          recipientHash: this.recipientHash(to),
          attempt: job.attemptsMade + 1,
          attemptsAllowed: job.opts.attempts,
        },
        `Could not deliver a transactional email: ${(error as Error).message}`,
      );
      // Rethrown on purpose: BullMQ decides whether to retry, and a job that has exhausted its
      // attempts stays in the failed set where somebody can see it.
      throw error;
    }
  }
}
