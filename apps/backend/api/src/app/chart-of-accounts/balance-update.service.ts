import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue, JobsOptions } from 'bullmq';
import { EntityManager } from 'typeorm';
import { SingleBalanceUpdateJobData } from './balance-update.processor';
import { AfterCommitService } from '../shared/after-commit/after-commit.service';

interface BulkJob {
  name: string;
  data: SingleBalanceUpdateJobData;
  opts: JobsOptions;
}

/**
 * Queues the balance updates a posted journal entry implies.
 *
 * ## Why the enqueue waits for the commit
 *
 * `queueBalanceUpdates` is called from inside `_postJournalEntry`, which runs inside the caller's
 * database transaction. BullMQ hands a job to a worker the moment it is enqueued, so the worker —
 * a separate process on a separate connection — would try to update the balance of an account the
 * transaction has not committed yet, and on a newly provisioned tenant of an account no other
 * connection can see at all. That produced a foreign-key violation on `account_balances` on the
 * first posting of every account.
 *
 * This used to be handled with a two-second delay on the job, which is a guess about how long a
 * transaction takes and says nothing at all about the rollback case. The enqueue now goes through
 * `AfterCommitService`, so the job is published after `COMMIT` returns and never published at all
 * if the transaction is rolled back. The retries below stay as the safety net for the queue itself.
 */
@Injectable()
export class BalanceUpdateService {
  private readonly logger = new Logger(BalanceUpdateService.name);

  constructor(
    @InjectQueue('balance-updates-v2') private readonly balanceUpdatesQueue: Queue,
    private readonly afterCommit: AfterCommitService,
  ) {}

  /**
   * @param manager the manager the journal entry was written through — it identifies the
   *   transaction whose commit the enqueue has to wait for.
   */
  async queueBalanceUpdates(
    manager: EntityManager,
    organizationId: string,
    ledgerId: string,
    updates: Map<string, number>,
    journalEntryId: string,
  ) {
    if (updates.size === 0) return;

    this.logger.log(
      `Encolando ${updates.size} actualizaciones de saldo del asiento ${journalEntryId} en el libro ${ledgerId}.`,
    );

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
        // Idempotency key: a retried posting of the same entry and account is the same job, so a
        // duplicate enqueue cannot double-count a balance.
        jobId: `balance-update-${journalEntryId}-${accountId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 50,
      };

      jobs.push({ name: 'update-single-account-balance', data: jobData, opts: jobOptions });
    }

    await this.afterCommit.runAfterCommit(
      manager,
      `saldos del asiento ${journalEntryId}`,
      () => this.balanceUpdatesQueue.addBulk(jobs),
    );
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
