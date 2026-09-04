
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { RecurringJournalEntry, Frequency } from './entities/recurring-journal-entry.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreateRecurringJournalEntryDto, UpdateRecurringJournalEntryDto } from './dto/recurring-and-templates.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotFoundError } from '../i18n/localized.exception';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import {
  daysBetween,
  endOfMonthIso,
  toIsoDate,
  todayIso,
  toUtcDate,
  type IsoDate,
} from '../common/dates';

export interface RecurringJobData {
    recurringEntryId: string;
    dateToPost: string;
}

@Injectable()
export class RecurringJournalEntriesService {
  private readonly logger = new Logger(RecurringJournalEntriesService.name);

  constructor(
    private readonly schedulerLock: SchedulerLockService,
    @InjectRepository(RecurringJournalEntry)
    private recurringRepository: Repository<RecurringJournalEntry>,


    @InjectQueue('recurring-entries-processor') private recurringQueue: Queue<RecurringJobData>,
  ) {}

  create(createDto: CreateRecurringJournalEntryDto, organizationId: string): Promise<RecurringJournalEntry> {
    const recurringEntry = this.recurringRepository.create({ 
      ...createDto, 
      organizationId, 
      isActive: true
    });
    return this.recurringRepository.save(recurringEntry);
  }

  findAll(organizationId: string): Promise<RecurringJournalEntry[]> {
    return this.recurringRepository.find({ where: { organizationId } });
  }

  async findOne(id: string, organizationId: string): Promise<RecurringJournalEntry> {
    const entry = await this.recurringRepository.findOneBy({ id, organizationId });
    if (!entry) {
      throw new NotFoundError('JOURNAL_ENTRIES.PLANTILLA_ASIENTO_RECURRENTE_ID_NO_ENCONTRADA', { id });
    }
    return entry;
  }

  async update(id: string, updateDto: UpdateRecurringJournalEntryDto, organizationId: string): Promise<RecurringJournalEntry> {
    const entry = await this.findOne(id, organizationId);
    const updatedEntry = this.recurringRepository.merge(entry, updateDto);
    return this.recurringRepository.save(updatedEntry);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.recurringRepository.delete({ id, organizationId });
    if (result.affected === 0) {
      throw new NotFoundError('JOURNAL_ENTRIES.PLANTILLA_ASIENTO_RECURRENTE_ID_NO_ENCONTRADA', { id });
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'queue-recurring-journal-entries' })
  async handleCron() {
    this.logger.log('Iniciando job para encolar asientos recurrentes...');

    const today = todayIso();

    // Scoped per tenant below via the claim key. The query itself spans tenants because the
    // scheduler is a single process acting for all of them.
    const recurringEntries = await this.recurringRepository.find({ where: { isActive: true } });
    this.logger.log(`Se encontraron ${recurringEntries.length} plantillas activas para evaluar.`);

    for (const entry of recurringEntries) {
      if (!this.isDue(entry, today)) continue;

      // The durable claim, not just BullMQ's `jobId`. A completed job is removed from the
      // queue, which frees its id — so with two replicas firing the same minute the dedup
      // window is whatever the queue happens to be retaining.
      const claimed = await this.schedulerLock.runOnce(
        'queue-recurring-journal-entries',
        `${entry.organizationId}:${entry.id}:${today}`,
        async () => {
          await this.recurringQueue.add(
            'generate-recurring-entry',
            { recurringEntryId: entry.id, dateToPost: today },
            {
              jobId: `recurring-${entry.id}-${today}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 60000 },
            },
          );
        },
      );
      if (claimed) {
        this.logger.log(`Asiento recurrente ${entry.id} encolado para ${today}.`);
      }
    }
    this.logger.log('Job de encolado de asientos recurrentes finalizado.');
  }

  /**
   * Whether a template falls due on `today`.
   *
   * Everything is compared as `YYYY-MM-DD` — lexicographic order on that format is chronological
   * order, so no `Date` is constructed for the window checks and no timezone can move a day.
   *
   * The previous version did `new Date(entry.startDate)` and then `setHours(0,0,0,0)`: the first
   * parses `'2026-01-15'` as UTC midnight, the second re-anchors it to *local* midnight. On any
   * deployment west of Greenwich the template's own start date read as the day before, so
   * `getDate()` returned 14 for a template that starts on the 15th — a monthly entry posted a day
   * early, every month, and an annual one on a 1 January start was evaluated as 31 December and
   * never fired.
   *
   * Exposed as `isDue` rather than the old `shouldCreateJournalEntryToday` because it is now a pure
   * function of two values and is worth testing directly.
   */
  isDue(entry: RecurringJournalEntry, today: IsoDate): boolean {
    const start = toIsoDate(entry.startDate);
    if (start > today) return false;
    if (entry.endDate && toIsoDate(entry.endDate) < today) return false;
    // Already run today. Belt to the scheduler claim's braces: the claim stops two replicas, this
    // stops a re-queue after a manual run.
    if (entry.lastRunDate && toIsoDate(entry.lastRunDate) === today) return false;

    switch (entry.frequency) {
      case Frequency.DAILY:
        return true;

      case Frequency.WEEKLY:
        // Same weekday as the start date. `daysBetween` is exact on calendar days, so this needs
        // no day-of-week lookup and cannot be shifted by a DST transition.
        return daysBetween(start, today) % 7 === 0;

      case Frequency.MONTHLY: {
        const startDay = Number(start.slice(8, 10));
        const todayDay = Number(today.slice(8, 10));
        // A template that starts on the 29th, 30th or 31st runs on the last day of any month that
        // is shorter than that, rather than skipping the month entirely.
        if (startDay > 28 && today === endOfMonthIso(today)) {
          return todayDay <= startDay;
        }
        return todayDay === startDay;
      }

      case Frequency.ANNUALLY: {
        const startMonthDay = start.slice(5, 10);
        if (startMonthDay === today.slice(5, 10)) return true;
        // 29 February in a common year: run on the 28th rather than skipping the year.
        return startMonthDay === '02-29' && today.slice(5, 10) === '02-28' && !isLeapYear(today);
      }

      default:
        return false;
    }
  }
}

function isLeapYear(date: IsoDate): boolean {
  return toUtcDate(`${date.slice(0, 4)}-02-29`).getUTCMonth() === 1;
}