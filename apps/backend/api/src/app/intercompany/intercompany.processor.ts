import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import {
  DestinationEntryJobData,
  IntercompanyService,
  INTERCOMPANY_QUEUE,
} from './intercompany.service';

/**
 * Posts the receiving company's half of an intercompany movement.
 *
 * ## Why this file did not exist
 *
 * `IntercompanyService` enqueued a job on `intercompany-jobs` and nothing consumed it. The queue
 * was not registered with `BullModule` either, so `@InjectQueue` would have failed to resolve had
 * the module ever been loaded — which it was not. The net effect was that every intercompany
 * transaction posted the sending company's entry, wrote a PENDING row, and left the group's books
 * permanently out of balance with a single log line saying the job had been queued.
 *
 * ## Failure is recorded on the row, not only in the log
 *
 * A destination company with a closed period or an unconfigured intercompany account is an
 * operational condition someone has to see. BullMQ retries five times with exponential backoff; on
 * the last attempt the reason is written to `failureReason` and the row moves to FAILED, where
 * `findPending` — and the report behind it — will show it.
 */
@Processor(INTERCOMPANY_QUEUE)
export class IntercompanyProcessor extends WorkerHost {
  private readonly logger = new Logger(IntercompanyProcessor.name);

  constructor(private readonly intercompanyService: IntercompanyService) {
    super();
  }

  async process(job: Job<DestinationEntryJobData>): Promise<void> {
    const { intercompanyTransactionId } = job.data;
    try {
      await this.intercompanyService.postDestinationEntry(intercompanyTransactionId);
    } catch (error) {
      const reason = (error as Error).message;
      const attemptsMade = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 1;

      this.logger.error(
        `Asiento de destino de ${intercompanyTransactionId} falló (intento ${attemptsMade}/${maxAttempts}): ${reason}`,
        (error as Error).stack,
      );

      if (attemptsMade >= maxAttempts) {
        await this.intercompanyService.recordFailure(intercompanyTransactionId, reason);
      }
      throw error;
    }
  }
}
