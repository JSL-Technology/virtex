
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, LessThan } from 'typeorm';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntriesService } from './journal-entries.service';
import { AccountingPeriod, PeriodStatus } from '../accounting/entities/accounting-period.entity';
import { endOfMonth, startOfMonth } from 'date-fns';

@Injectable()
export class AutoReversalService {
  private readonly logger = new Logger(AutoReversalService.name);
  private isJobRunning = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly journalEntriesService: JournalEntriesService,
  ) {}

  @Cron('0 4 1 * *', { name: 'auto-reversals' })
  async handleCron() {
    if (this.isJobRunning) {
      this.logger.warn('Auto-reversal job is already running. Skipping this execution.');
      return;
    }

    this.isJobRunning = true;
    this.logger.log('Starting scheduled job: Automatic Journal Entry Reversals.');

    try {
      const today = new Date();
      const firstDayOfCurrentMonth = startOfMonth(today);
      const lastDayOfPreviousMonth = endOfMonth(new Date(today.setDate(0)));

      const periodsToProcess = await this.dataSource.getRepository(AccountingPeriod).find({
        where: {
          endDate: lastDayOfPreviousMonth,
          status: PeriodStatus.OPEN,
        },
      });

      for (const period of periodsToProcess) {
        this.logger.log(`Processing reversals for organization ${period.organizationId} for period ending ${period.endDate.toISOString()}`);
        
        const entriesToReverse = await this.dataSource.getRepository(JournalEntry).find({
          where: {
            organizationId: period.organizationId,
            reversesNextPeriod: true,
            isReversed: false,
            date: LessThan(firstDayOfCurrentMonth),
          },
        });

        if (entriesToReverse.length === 0) {
          this.logger.log(`No entries to reverse for organization ${period.organizationId}.`);
          continue;
        }

        for (const entry of entriesToReverse) {
          try {
            await this.journalEntriesService.createReversalEntry(entry.id, entry.organizationId);
            this.logger.log(`Successfully reversed journal entry ${entry.id}.`);
          } catch (error) {
            this.logger.error(`Failed to reverse journal entry ${entry.id}. Reason: ${error.message}`, error.stack);
          }
        }
      }
    } catch (error) {
      this.logger.error('An unexpected error occurred during the auto-reversal job.', error.stack);
    } finally {
      this.isJobRunning = false;
      this.logger.log('Finished scheduled job: Automatic Journal Entry Reversals.');
    }
  }
}