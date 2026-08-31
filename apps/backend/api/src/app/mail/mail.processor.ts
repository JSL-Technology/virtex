import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { Job } from 'bullmq';
import { createHash } from 'crypto';

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

  constructor(private readonly mailerService: MailerService) {
    super();
  }

  private recipientHash(to: string): string {
    return createHash('sha256').update(to.toLowerCase().trim()).digest('hex').slice(0, 12);
  }

  async process(job: Job<MailJob>): Promise<void> {
    const { to, subject, template, context } = job.data;

    try {
      await this.mailerService.sendMail({ to, subject, template, context });
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
