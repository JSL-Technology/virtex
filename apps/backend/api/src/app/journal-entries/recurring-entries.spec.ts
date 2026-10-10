import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { testExchangeRateResolver } from '../currencies/exchange-rate-resolver.testing';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from './entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import {
  AccountCategory,
  AccountNature,
  AccountRole,
  AccountType,
} from '../chart-of-accounts/enums/account-enums';
import {
  AccountingPeriod,
  PeriodStatus,
} from '../accounting/entities/accounting-period.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryAttachment } from './entities/journal-entry-attachment.entity';
import {
  Frequency,
  RecurringJournalEntry,
} from './entities/recurring-journal-entry.entity';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntryNumberingService } from './journal-entry-numbering.service';
import { RecurringEntriesProcessor } from './recurring-entries.processor';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { RecurringJournalEntriesService } from './recurring-journal-entries.service';
import { JournalEntryTemplatesService } from './journal-entry-templates.service';
import { JournalEntryTemplate } from './entities/journal-entry-template.entity';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';

/**
 * A recurring template posts its occurrence once, however many times the job is delivered.
 *
 * The processor posted and *then* stamped `lastRunDate`, and never read it: no guard, no unique
 * index over (template, date), no idempotency key. The deterministic `jobId` used at enqueue time
 * deduplicates the enqueue, not the execution — BullMQ recovers stalled jobs when a worker dies,
 * and a worker that dies after the SQL commit and before the acknowledgement causes a second run.
 * The transaction commits again and the entry is duplicated: a monthly rent, an insurance
 * amortisation or a payroll accrual booked twice, with nothing anywhere to flag it.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('recurring journal entries', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let processor: RecurringEntriesProcessor;
  let recurring: RecurringJournalEntriesService;
  let templates: JournalEntryTemplatesService;

  let organizationId: string;
  let journalId: string;
  const account: Record<string, string> = {};

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();

    const entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null), announcePending: jest.fn() } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      new AuditTrailService(dataSource.getRepository(AuditLog)),
      testExchangeRateResolver(dataSource),
    );
    processor = new RecurringEntriesProcessor(dataSource, entries);
    recurring = new RecurringJournalEntriesService(
      new SchedulerLockService(dataSource),
      dataSource.getRepository(RecurringJournalEntry),
      { add: jest.fn() } as never,
    );
    templates = new JournalEntryTemplatesService(dataSource.getRepository(JournalEntryTemplate), entries, dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Recurrente ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    const ledger = await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({
        organizationId,
        name: 'Principal',
        currency: 'DOP',
        isDefault: true,
        isActive: true,
      }),
    );

    const journal = await dataSource.getRepository(Journal).save({
      organizationId,
      code: 'GENERAL',
      name: 'Diario general',
      type: 'GENERAL' as const,
    });
    journalId = journal.id;

    const make = async (
      key: string,
      code: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
      systemRole: AccountRole | null = null,
    ) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code,
          name: { es: code },
          type,
          category,
          nature,
          systemRole,
          isPostable: true,
          isActive: true,
        }),
      );
      account[key] = saved.id;
    };

    await make('expense', '5101', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await make('payable', '2101', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, AccountNature.CREDIT, AccountRole.ACCOUNTS_PAYABLE);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({ organizationId, baseCurrency: 'DOP' }),
    );

    await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Marzo 2026', startDate: '2026-03-01' as unknown as Date, endDate: '2026-03-31' as unknown as Date, status: PeriodStatus.OPEN },
      { organizationId, name: 'Abril 2026', startDate: '2026-04-01' as unknown as Date, endDate: '2026-04-30' as unknown as Date, status: PeriodStatus.OPEN },
    ]);
  });

  afterEach(async () => {
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  const template = () =>
    dataSource.getRepository(RecurringJournalEntry).save(
      dataSource.getRepository(RecurringJournalEntry).create({
        organizationId,
        description: 'Alquiler mensual',
        journalId,
        frequency: Frequency.MONTHLY,
        startDate: '2026-03-01',
        isActive: true,
        lines: [
          { accountId: account['expense'], debit: 30_000, credit: 0 },
          { accountId: account['payable'], debit: 0, credit: 30_000 },
        ] as never,
      }),
    );

  // `organizationId` travels in the payload because the processor establishes the tenant context
  // from it before touching anything. Looking it up instead would be circular: under the row-level
  // policies, reading the recurring entry is exactly what has no context yet.
  const run = (recurringEntryId: string, dateToPost: string) =>
    processor.process({
      id: `recurring:${recurringEntryId}:${dateToPost}`,
      data: { recurringEntryId, dateToPost, organizationId },
    } as Job<{ recurringEntryId: string; dateToPost: string; organizationId: string }>);

  const postedCount = () =>
    dataSource.getRepository(JournalEntry).count({ where: { organizationId } });

  it('posts the occurrence once', async () => {
    const entry = await template();
    await run(entry.id, '2026-03-01');

    expect(await postedCount()).toBe(1);
    const reloaded = await dataSource
      .getRepository(RecurringJournalEntry)
      .findOneByOrFail({ id: entry.id });
    expect(reloaded.lastRunDate).toBe('2026-03-01');
  });

  it('does nothing when the same job is delivered again', async () => {
    // The case BullMQ produces on its own: a worker that dies after the commit and before the
    // acknowledgement. The old processor committed a second identical entry — a rent booked twice.
    const entry = await template();
    await run(entry.id, '2026-03-01');
    await run(entry.id, '2026-03-01');

    expect(await postedCount()).toBe(1);
  });

  it('still posts the next occurrence', async () => {
    const entry = await template();
    await run(entry.id, '2026-03-01');
    await run(entry.id, '2026-04-01');

    expect(await postedCount()).toBe(2);
  });

  it('stamps an idempotency key the database enforces', async () => {
    // The structural guard behind the re-read: two workers racing on a redelivered job can both
    // find the template unstamped, and only a unique index makes the second posting impossible
    // rather than merely unlikely.
    const entry = await template();
    await run(entry.id, '2026-03-01');

    const [posted] = await dataSource
      .getRepository(JournalEntry)
      .find({ where: { organizationId } });
    expect(posted.idempotencyKey).toBe(`recurring:${entry.id}:2026-03-01`);
    expect(posted.systemReason).toBe('recurring-entry');
  });

  it('refuses a second posting of the same occurrence even past the date guard', async () => {
    const entry = await template();
    await run(entry.id, '2026-03-01');

    // Rewind the stamp, which is what a lost update would leave behind, and run again. The unique
    // index on (organization, idempotency_key) returns the entry already posted instead of
    // writing a second one.
    await dataSource
      .getRepository(RecurringJournalEntry)
      .update({ id: entry.id }, { lastRunDate: null });
    await run(entry.id, '2026-03-01');

    expect(await postedCount()).toBe(1);
  });

  it('posts the occurrences a catch-up queued in any order, each once', async () => {
    const entry = await template();
    // The April job finishing before the March one: March must not look done.
    await run(entry.id, '2026-04-01');
    await run(entry.id, '2026-03-01');
    await run(entry.id, '2026-03-01');

    expect(await postedCount()).toBe(2);
    const reloaded = await dataSource.getRepository(RecurringJournalEntry).findOneByOrFail({ id: entry.id });
    expect(reloaded.lastRunDate).toBe('2026-04-01');
    expect(recurring.dueDates(reloaded, '2026-05-15')).toEqual(['2026-05-01']);
  });

  it('skips an occurrence queued before the entry was paused', async () => {
    const entry = await template();
    await dataSource.getRepository(RecurringJournalEntry).update({ id: entry.id }, { isActive: false });
    await run(entry.id, '2026-03-01');
    expect(await postedCount()).toBe(0);
  });

  it('refuses a recurring entry that could never post, when it is saved', async () => {
    const base = {
      description: 'Seguro',
      journalId,
      frequency: Frequency.MONTHLY,
      startDate: '2026-03-15',
      lines: [
        { accountId: account['expense'], debit: 1_000, credit: 0 },
        { accountId: account['payable'], debit: 0, credit: 1_000 },
      ],
    };
    await expect(
      recurring.create({ ...base, lines: [base.lines[0], { ...base.lines[1], credit: 900 }] } as never, organizationId),
    ).rejects.toMatchObject({ messageKey: 'journal_entries.journal_entry_does_not_balance' });
    await expect(
      recurring.create({ ...base, lines: [base.lines[0], { ...base.lines[1], accountId: '00000000-0000-4000-8000-0000000000ff' }] } as never, organizationId),
    ).rejects.toMatchObject({ messageKey: 'journal_entries.stored_line_account_not_found' });
    await expect(recurring.create({ ...base, endDate: '2026-01-01' } as never, organizationId)).rejects.toMatchObject({
      messageKey: 'journal_entries.recurring_end_before_start',
    });

    const saved = await recurring.create(base as never, organizationId);
    expect(saved.amount).toBe(1_000);
    expect(saved.nextRunDate).toBe('2026-03-15');

    const paused = await recurring.update(saved.id, { isActive: false } as never, organizationId);
    expect(paused.isActive).toBe(false);
    expect(paused.pendingOccurrences).toBe(0);
  });

  it('splits a template by its percentages so the entry balances', async () => {
    const rent = await templates.create(
      {
        name: 'Alquiler',
        description: 'Alquiler del local',
        lines: [
          { accountId: account['expense'], type: 'DEBIT', percentage: 60 },
          { accountId: account['expense'], type: 'DEBIT', percentage: 40 },
          { accountId: account['payable'], type: 'CREDIT' },
        ],
      },
      organizationId,
    );
    const posted = await templates.createEntryFromTemplate(
      rent.id,
      { date: '2026-03-10', description: 'Alquiler de marzo', amount: 1_000.01, journalId },
      organizationId,
      '11111111-1111-4111-8111-111111111111',
    );
    const lines = await dataSource.query<{ debit: string; credit: string }[]>(
      `SELECT debit, credit FROM journal_entry_lines WHERE journal_entry_id = $1 ORDER BY debit DESC, credit DESC`,
      [posted.id],
    );
    expect(lines.map((line) => [Number(line.debit), Number(line.credit)])).toEqual([
      [600.01, 0],
      [400, 0],
      [0, 1_000.01],
    ]);

    await expect(
      templates.create(
        {
          name: 'Mal',
          description: 'No suma 100',
          lines: [
            { accountId: account['expense'], type: 'DEBIT', percentage: 60 },
            { accountId: account['expense'], type: 'DEBIT', percentage: 30 },
            { accountId: account['payable'], type: 'CREDIT' },
          ],
        },
        organizationId,
      ),
    ).rejects.toMatchObject({ messageKey: 'journal_entries.template_percentages_must_total_100' });
  });
});
