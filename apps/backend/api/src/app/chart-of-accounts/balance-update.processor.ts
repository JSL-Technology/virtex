
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource, UpdateResult } from 'typeorm';
import { AccountBalance } from './entities/account-balance.entity';

export interface SingleBalanceUpdateJobData {
  organizationId: string;
  ledgerId: string;
  accountId: string;
  netChange: number;
  journalEntryId: string;
}

@Processor('balance-updates-v2', {
  concurrency: 20,
})
export class BalanceUpdateProcessor extends WorkerHost {
  private readonly logger = new Logger(BalanceUpdateProcessor.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job<SingleBalanceUpdateJobData>): Promise<void> {
    const { ledgerId, accountId, netChange, journalEntryId } = job.data;
    const attempt = job.attemptsMade;
    this.logger.log(`Processing Job ID: ${job.id} (Attempt: ${attempt}) for JE: ${journalEntryId}, Account: ${accountId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // A single atomic upsert.
      //
      // The previous shape was "INSERT … ON CONFLICT DO NOTHING, then read the version, then
      // UPDATE … WHERE version = :version". Two things made it unusable: `account_balances` has a
      // COMPOSITE primary key, so a successful insert returns no identifiers and the code could not
      // tell an insert from a conflict; and the follow-up read ran in a different statement, so the
      // "optimistic lock" it implemented raced with itself and threw
      // `balance record not found after insert attempt` on the very first posting of every account.
      //
      // `ON CONFLICT … DO UPDATE` needs no version at all: PostgreSQL applies the row lock, and
      // `balance + EXCLUDED.balance` is correct under any interleaving.
      await queryRunner.query(
        `INSERT INTO "account_balances" ("account_id", "ledger_id", "balance", "version", "last_updated_at")
         VALUES ($1, $2, $3, 1, now())
         ON CONFLICT ("account_id", "ledger_id") DO UPDATE
         SET "balance" = "account_balances"."balance" + EXCLUDED."balance",
             "version" = "account_balances"."version" + 1,
             "last_updated_at" = now()`,
        [accountId, ledgerId, netChange],
      );

      this.logger.log(`Job ${job.id}: Balance for account ${accountId} updated successfully.`);
    } catch (error) {
      this.logger.error(`Job ${job.id}: Failed with error: ${(error as Error).message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job Completed: ${job.id}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job Failed: ${job.id}. Reason: ${error.message}`, error.stack);
  }
}
