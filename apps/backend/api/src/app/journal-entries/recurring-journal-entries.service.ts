
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { RecurringJournalEntry, Frequency } from './entities/recurring-journal-entry.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreateRecurringJournalEntryDto, UpdateRecurringJournalEntryDto } from './dto/recurring-and-templates.dto';
import { addDays, addMonths, addYears, isSameDay, isLastDayOfMonth } from 'date-fns';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotFoundError } from '../i18n/localized.exception';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';

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
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Scoped per tenant below via the claim key. The query itself spans tenants because the
    // scheduler is a single process acting for all of them.
    const recurringEntries = await this.recurringRepository.find({ where: { isActive: true } });
    this.logger.log(`Se encontraron ${recurringEntries.length} plantillas activas para evaluar.`);

    for (const entry of recurringEntries) {

        if (this.shouldCreateJournalEntryToday(entry, today)) {


            const day = today.toISOString().slice(0, 10);
            // The durable claim, not just BullMQ's `jobId`. A completed job is removed from the
            // queue, which frees its id — so with two replicas firing the same minute the dedup
            // window is whatever the queue happens to be retaining.
            const claimed = await this.schedulerLock.runOnce(
              'queue-recurring-journal-entries',
              `${entry.organizationId}:${entry.id}:${day}`,
              async () => {
                await this.recurringQueue.add(
                  'generate-recurring-entry',
                  { recurringEntryId: entry.id, dateToPost: today.toISOString() },
                  {
                    jobId: `recurring-${entry.id}-${day}`,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 60000 },
                  },
                );
              },
            );
            if (claimed) {
              this.logger.log(`Asiento recurrente ${entry.id} encolado para ${day}.`);
            }
        }
    }
     this.logger.log('Job de encolado de asientos recurrentes finalizado.');
  }

  private shouldCreateJournalEntryToday(entry: RecurringJournalEntry, today: Date): boolean {
    const startDate = new Date(entry.startDate);
    startDate.setHours(0, 0, 0, 0);


    if (startDate > today) {
      return false;
    }


    if (entry.endDate && new Date(entry.endDate) < today) {
      return false;
    }
    


    if (entry.lastRunDate && isSameDay(new Date(entry.lastRunDate), today)) {
      return false;
    }


    switch (entry.frequency) {
      case Frequency.DAILY:
        return true;
      
      case Frequency.WEEKLY:

        return today.getDay() === startDate.getDay();
      
      case Frequency.MONTHLY: {
        const startDayOfMonth = startDate.getDate();

        if (startDayOfMonth > 28 && isLastDayOfMonth(today)) {
          return true;
        }
        return today.getDate() === startDayOfMonth;
      }
      
      case Frequency.ANNUALLY: 

        return today.getMonth() === startDate.getMonth() && today.getDate() === startDate.getDate();
      
      default:

        return false;
    }
  }




}