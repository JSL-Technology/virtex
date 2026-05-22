
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SingleBalanceUpdateJobData } from './balance-update.processor';
import { JobsOptions, Job } from 'bullmq';


interface BulkJob {
  name: string;
  data: SingleBalanceUpdateJobData;
  opts: JobsOptions;
}

@Injectable()
export class BalanceUpdateService {
  private readonly logger = new Logger(BalanceUpdateService.name);

  constructor(
    @InjectQueue('balance-updates-v2') private readonly balanceUpdatesQueue: Queue,
  ) {}

  async queueBalanceUpdates(
    organizationId: string,
    ledgerId: string,
    updates: Map<string, number>,
    journalEntryId: string,
  ) {
    if (updates.size === 0) return;

    this.logger.log(`Queueing ${updates.size} balance updates for JE ${journalEntryId} in ledger ${ledgerId}.`);
    

    const jobs: BulkJob[] = [];
    for (const [accountId, netChange] of updates.entries()) {
      const jobData: SingleBalanceUpdateJobData = {
        organizationId,
        ledgerId,
        accountId,
        netChange,
        journalEntryId,
      };
      const jobOptions: JobsOptions = {
        jobId: `balance-update-${journalEntryId}-${accountId}`,
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: 50,
      };

      jobs.push({ name: 'update-single-account-balance', data: jobData, opts: jobOptions });
    }

    await this.balanceUpdatesQueue.addBulk(jobs);
  }

  async getQueueStatus() {
    return {
      name: this.balanceUpdatesQueue.name,
      counts: await this.balanceUpdatesQueue.getJobCounts(
        'wait',
        'completed',
        'failed',
        'active',
        'delayed',
      ),
    };
  }
}

