
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

      if (attempt === 0) {
        const insertResult = await queryRunner.manager.getRepository(AccountBalance)
          .createQueryBuilder()
          .insert()
          .into(AccountBalance)
          .values({ accountId, ledgerId, balance: netChange, version: 1 })
          .onConflict(`("accountId", "ledgerId") DO NOTHING`)
          .execute();
        
        if (insertResult.raw.affectedRows > 0 || insertResult.identifiers.length > 0) {
          this.logger.log(`Job ${job.id}: Inserted initial balance for account ${accountId}.`);
          return;
        }
      }


      const balanceRepo = queryRunner.manager.getRepository(AccountBalance);
      const currentBalance = await balanceRepo.findOne({ where: { accountId, ledgerId }, select: ['version'] });

      if (!currentBalance) {
        this.logger.error(`Job ${job.id}: Race condition detected. AccountBalance for ${accountId} disappeared after failed insert.`);
        throw new Error('Optimistic lock failed: balance record not found after insert attempt.');
      }

      const result: UpdateResult = await balanceRepo.createQueryBuilder()
        .update()
        .set({ 
          balance: () => `balance + ${netChange}`,
          version: () => 'version + 1',
          lastUpdatedAt: new Date(),
        })
        .where("accountId = :accountId AND ledgerId = :ledgerId AND version = :version", {
          accountId,
          ledgerId,
          version: currentBalance.version,
        })
        .execute();

      if (result.affected === 0) {
        this.logger.warn(`Job ${job.id}: Optimistic lock failed for account ${accountId}. Version mismatch. Retrying...`);
        throw new Error('Optimistic lock failed: version mismatch');
      }

      this.logger.log(`Job ${job.id}: Balance for account ${accountId} updated successfully.`);
    } catch (error) {
      this.logger.error(`Job ${job.id}: Failed with error: ${error.message}`);
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
