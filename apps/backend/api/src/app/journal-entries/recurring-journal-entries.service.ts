import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { RecurringJournalEntry } from './entities/recurring-journal-entry.entity';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreateRecurringJournalEntryDto, UpdateRecurringJournalEntryDto } from './dto/recurring-and-templates.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { toIsoDate, todayIso, type IsoDate } from '../common/dates';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { roundAmount } from '../common/money';
import { assertBalancedLines, assertJournal, assertStoredLines, StoredLine } from './stored-lines';
import { beforeStart, nextOccurrence, occurrencesBetween } from './recurring-schedule';

export interface RecurringJobData {
  recurringEntryId: string;
  dateToPost: string;
  /** The company the entry belongs to. See DestinationEntryJobData for why it is carried. */
  organizationId: string;
}

/** A recurring entry as the screens read it: what it posts, and when it will next. */
export interface RecurringJournalEntryView extends RecurringJournalEntry {
  /** The next date it will post on, or null once its end date has passed. */
  nextRunDate: string | null;
  /** Occurrences already due and not yet posted — what the next run will catch up. */
  pendingOccurrences: number;
  /** The amount each occurrence posts: the sum of its debits. */
  amount: number;
}

/** One entry a recurring entry posted. */
export interface RecurringPostedEntry {
  id: string;
  entryNumber: string | null;
  date: string;
  status: string;
  amount: number;
}

/**
 * Recurring journal entries: the rent, the insurance amortisation, the payroll accrual — an entry
 * posted on a schedule.
 *
 * Saved unchecked once: an unbalanced entry, an account from another company, a journal that did
 * not exist were all accepted and failed every night in the queue. And the scheduler asked only
 * «is it due today?», so a day it did not run lost that occurrence for good. Both are fixed here:
 * the entry is validated when saved, and each run posts every occurrence since the last one.
 */
@Injectable()
export class RecurringJournalEntriesService {
  private readonly logger = new Logger(RecurringJournalEntriesService.name);

  constructor(
    private readonly schedulerLock: SchedulerLockService,
    @InjectRepository(RecurringJournalEntry)
    private recurringRepository: Repository<RecurringJournalEntry>,
    @InjectQueue('recurring-entries-processor') private recurringQueue: Queue<RecurringJobData>,
  ) {}

  async create(dto: CreateRecurringJournalEntryDto, organizationId: string): Promise<RecurringJournalEntryView> {
    return this.recurringRepository.manager.transaction(async (manager) => {
      const lines = await this.validate(manager, organizationId, {
        journalId: dto.journalId,
        lines: dto.lines,
        startDate: dto.startDate,
        endDate: dto.endDate ?? null,
      });
      const saved = await manager.save(
        manager.create(RecurringJournalEntry, {
          organizationId,
          description: dto.description.trim(),
          journalId: dto.journalId,
          lines: lines as never,
          frequency: dto.frequency,
          startDate: toIsoDate(dto.startDate),
          endDate: dto.endDate ? toIsoDate(dto.endDate) : null,
          isActive: dto.isActive ?? true,
        }),
      );
      return this.view(saved, await organizationToday(manager, organizationId));
    });
  }

  async findAll(organizationId: string): Promise<RecurringJournalEntryView[]> {
    const rows = await this.recurringRepository.find({
      where: { organizationId },
      order: { isActive: 'DESC', description: 'ASC' },
    });
    const today = await organizationToday(this.recurringRepository.manager, organizationId);
    return rows.map((row) => this.view(row, today));
  }

  async findOne(id: string, organizationId: string): Promise<RecurringJournalEntryView> {
    const entry = await this.load(this.recurringRepository.manager, id, organizationId);
    return this.view(entry, await organizationToday(this.recurringRepository.manager, organizationId));
  }

  /**
   * Change what it posts, or when. Occurrences already posted stay as they were; the change applies
   * from the next one. Pausing (`isActive: false`) stops the posting without losing the schedule;
   * resuming catches up what fell due meanwhile — or move the start date to skip it.
   */
  async update(id: string, dto: UpdateRecurringJournalEntryDto, organizationId: string): Promise<RecurringJournalEntryView> {
    return this.recurringRepository.manager.transaction(async (manager) => {
      const entry = await this.load(manager, id, organizationId, true);
      const next = {
        journalId: dto.journalId ?? entry.journalId,
        lines: (dto.lines ?? entry.lines) as StoredLine[],
        startDate: dto.startDate ?? entry.startDate,
        endDate: dto.endDate !== undefined ? dto.endDate : entry.endDate,
      };
      const lines = await this.validate(manager, organizationId, next);
      entry.description = dto.description?.trim() ?? entry.description;
      entry.journalId = next.journalId;
      entry.lines = lines as never;
      entry.frequency = dto.frequency ?? entry.frequency;
      entry.startDate = toIsoDate(next.startDate);
      entry.endDate = next.endDate ? toIsoDate(next.endDate) : null;
      if (dto.isActive !== undefined) entry.isActive = dto.isActive;
      const saved = await manager.save(entry);
      return this.view(saved, await organizationToday(manager, organizationId));
    });
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.recurringRepository.delete({ id, organizationId });
    if (result.affected === 0) {
      throw new NotFoundError('journal_entries.recurring_journal_entry_template_id_not', { id });
    }
  }

  /** The entries it has posted, newest first — found by the idempotency key each one carries. */
  async postedEntries(id: string, organizationId: string): Promise<RecurringPostedEntry[]> {
    await this.load(this.recurringRepository.manager, id, organizationId);
    const rows = await this.recurringRepository.manager.query<
      Array<{ id: string; entry_number: string | null; date: string; status: string; amount: string }>
    >(
      `SELECT e.id, e.entry_number, TO_CHAR(e.date, 'YYYY-MM-DD') AS date, e.status,
              COALESCE((SELECT SUM(l.debit) FROM journal_entry_lines l WHERE l.journal_entry_id = e.id), 0) AS amount
         FROM journal_entries e
        WHERE e.organization_id = $1 AND e.idempotency_key LIKE $2
        ORDER BY e.date DESC
        LIMIT 200`,
      [organizationId, `recurring:${id}:%`],
    );
    return rows.map((row) => ({
      id: row.id,
      entryNumber: row.entry_number,
      date: row.date,
      status: row.status,
      amount: Number(row.amount),
    }));
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'queue-recurring-journal-entries' })
  async handleCron(): Promise<void> {
    this.logger.log('Iniciando job para encolar asientos recurrentes...');

    // Scoped per tenant below via the claim key. The query itself spans tenants because the
    // scheduler is a single process acting for all of them.
    const recurringEntries = await this.recurringRepository.find({ where: { isActive: true } });
    this.logger.log(`Se encontraron ${recurringEntries.length} plantillas activas para evaluar.`);

    const todayByTenant = new Map<string, IsoDate>();
    for (const entry of recurringEntries) {
      // Each company's own today: a rent due on the 1st is due on the 1st where the company is.
      let today = todayByTenant.get(entry.organizationId);
      if (!today) {
        today = await organizationToday(this.recurringRepository.manager, entry.organizationId).catch(() => todayIso());
        todayByTenant.set(entry.organizationId, today);
      }
      for (const date of this.dueDates(entry, today)) {
        await this.enqueue(entry, date);
      }
    }
    this.logger.log('Job de encolado de asientos recurrentes finalizado.');
  }

  /**
   * Every occurrence due by `today` and not yet posted. Kept as `isDue` for one date for callers
   * that ask the old question.
   */
  dueDates(entry: RecurringJournalEntry, today: IsoDate): IsoDate[] {
    const after = entry.lastRunDate ? toIsoDate(entry.lastRunDate) : beforeStart(entry);
    return occurrencesBetween(entry, after, today);
  }

  isDue(entry: RecurringJournalEntry, today: IsoDate): boolean {
    return this.dueDates(entry, today).includes(today);
  }

  private async enqueue(entry: RecurringJournalEntry, date: IsoDate): Promise<void> {
    // The durable claim, not just BullMQ's `jobId`. A completed job is removed from the queue,
    // which frees its id — so with two replicas firing the same minute the dedup window is
    // whatever the queue happens to be retaining.
    const claimed = await this.schedulerLock.runOnce(
      'queue-recurring-journal-entries',
      `${entry.organizationId}:${entry.id}:${date}`,
      async () => {
        await this.recurringQueue.add(
          'generate-recurring-entry',
          { recurringEntryId: entry.id, dateToPost: date, organizationId: entry.organizationId },
          {
            jobId: `recurring-${entry.id}-${date}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60000 },
          },
        );
      },
    );
    if (claimed) this.logger.log(`Asiento recurrente ${entry.id} encolado para ${date}.`);
  }

  private async validate(
    manager: EntityManager,
    organizationId: string,
    values: { journalId: string; lines: readonly StoredLine[]; startDate: string; endDate: string | null },
  ): Promise<StoredLine[]> {
    if (values.endDate && toIsoDate(values.endDate) < toIsoDate(values.startDate)) {
      throw new BadRequestError('journal_entries.recurring_end_before_start');
    }
    await assertJournal(manager, organizationId, values.journalId);
    const lines = values.lines.map((line) => ({
      accountId: line.accountId,
      description: line.description?.trim() || undefined,
      debit: roundAmount(Number(line.debit ?? 0)),
      credit: roundAmount(Number(line.credit ?? 0)),
      dimensions: line.dimensions ?? null,
    }));
    assertBalancedLines(lines);
    return assertStoredLines(manager, organizationId, lines);
  }

  private async load(manager: EntityManager, id: string, organizationId: string, lock = false): Promise<RecurringJournalEntry> {
    const entry = await manager.findOne(RecurringJournalEntry, {
      where: { id, organizationId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!entry) throw new NotFoundError('journal_entries.recurring_journal_entry_template_id_not', { id });
    return entry;
  }

  private view(entry: RecurringJournalEntry, today: IsoDate): RecurringJournalEntryView {
    const after = entry.lastRunDate ? toIsoDate(entry.lastRunDate) : beforeStart(entry);
    const amount = roundAmount(
      (entry.lines ?? []).reduce((sum, line) => sum + Math.round(Number(line.debit ?? 0) * 100), 0) / 100,
    );
    return {
      ...entry,
      // The first occurrence after the last one posted — in the past when the entry is behind.
      nextRunDate: nextOccurrence(entry, after),
      pendingOccurrences: entry.isActive ? occurrencesBetween(entry, after, today).length : 0,
      amount,
    };
  }
}
