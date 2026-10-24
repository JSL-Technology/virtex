import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { INBOUND_MAIL_QUEUE, InboundMailService } from './inbound-mail.service';

/** Turns received mail into drafts, one message at a time per worker. */
@Processor(INBOUND_MAIL_QUEUE, { concurrency: 2 })
export class InboundMailProcessor extends WorkerHost {
  constructor(private readonly inbound: InboundMailService) {
    super();
  }

  async process(job: Job<{ organizationId: string; messageId: string }>): Promise<void> {
    const attempts = Number(job.opts?.attempts ?? 1);
    await this.inbound.process(job.data.organizationId, job.data.messageId, job.attemptsMade + 1 >= attempts);
  }
}
