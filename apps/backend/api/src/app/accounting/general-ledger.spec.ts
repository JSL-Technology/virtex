import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from './entities/ledger.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import {
  AccountCategory,
  AccountNature,
  AccountType,
} from '../chart-of-accounts/enums/account-enums';
import { AccountingPeriod, PeriodStatus } from '../accounting/entities/accounting-period.entity';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { LedgersService } from './ledgers.service';
import { ReportsService } from '../reports/reports.service';
import { JournalReportDto } from '../journal-entries/dto/journal-report.dto';

/**
 * The libro mayor and the libro diario.
 *
 * Both are books of legal record in the Dominican Republic, Mexico, Colombia and Peru, and both
 * reported figures that no other part of the product agreed with: the general ledger summed every
 * journal line regardless of status, so drafts and entries awaiting approval sat in it alongside
 * posted ones, while the trial balance and the balance sheet counted only posted entries.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('general ledger and daybook', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let entries: JournalEntriesService;
  let ledgers: LedgersService;
  let reports: ReportsService;

  let organizationId: string;
  let ledgerId: string;
  let secondaryLedgerId: string;
  let journalId: string;
  const account: Record<string, string> = {};

  const ACTOR = '66666666-6666-4666-8666-666666666666';
  const ctx = { actorUserId: ACTOR };

  /** When true, the next entry created goes to PENDING_APPROVAL instead of POSTED. */
  let approvalRequired = false;

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

    const audit = new AuditTrailService(dataSource.getRepository(AuditLog));
    const balances = new AccountBalancesService(dataSource);

    entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      // An entry created through this route either posts or goes to approval; there is no draft
      // flag. Routing one through approval is how the suite obtains an unposted entry, which is
      // also the state a real tenant with an approval workflow has entries sitting in.
      {
        startApprovalProcess: jest.fn(async () =>
          approvalRequired ? { id: 'approval-request' } : null,
        ),
      } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      audit,
    );

    ledgers = new LedgersService(
      dataSource.getRepository(Ledger),
      dataSource.getRepository(Account),
      dataSource.getRepository(JournalEntryLine),
      balances,
    );

    reports = new ReportsService(
      {} as never,
      dataSource.getRepository(JournalEntryLine),
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(Account),
      dataSource.getRepository(Ledger),
      ledgers,
      dataSource,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    approvalRequired = false;
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Mayor ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    const saved = await dataSource.getRepository(Ledger).save([
      {
        organizationId,
        name: 'Libro principal',
        currency: 'DOP',
        isDefault: true,
        isActive: true,
      },
      {
        organizationId,
        name: 'Libro NIIF',
        currency: 'DOP',
        isDefault: false,
        isActive: true,
      },
    ]);
    ledgerId = saved[0].id;
    secondaryLedgerId = saved[1].id;

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
      label: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
    ) => {
      const row = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code,
          name: { es: label, en: label },
          type,
          category,
          nature,
          isPostable: true,
          isActive: true,
        }),
      );
      account[key] = row.id;
    };

    await make('cash', '1101', 'Efectivo', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('revenue', '4101', 'Ingresos', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.CREDIT);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({ organizationId, baseCurrency: 'DOP' }),
    );

    await dataSource.getRepository(AccountingPeriod).save({
      organizationId,
      name: 'Ejercicio 2026',
      startDate: '2026-01-01' as unknown as Date,
      endDate: '2026-12-31' as unknown as Date,
      status: PeriodStatus.OPEN,
    });
  });

  afterEach(async () => {
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  const post = (
    date: string,
    description: string,
    lines: { accountId: string; debit?: number; credit?: number; valuations?: unknown[] }[],
  ) =>
    entries.create(
      {
        date,
        description,
        journalId,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
          ...(line.valuations ? { valuations: line.valuations } : {}),
        })),
      } as unknown as CreateJournalEntryDto,
      organizationId,
      ctx,
    );

  const sale = async (date: string, amount: number, options: { post?: boolean } = {}) => {
    approvalRequired = options.post === false;
    try {
      return await post(date, `Venta ${date}`, [
        { accountId: account['cash'], debit: amount },
        { accountId: account['revenue'], credit: amount },
      ]);
    } finally {
      approvalRequired = false;
    }
  };

  const cardFor = (query: Partial<Parameters<LedgersService['getGeneralLedger']>[1]> = {}) =>
    ledgers.getGeneralLedger(organizationId, {
      accountId: account['cash'],
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      ...query,
    } as Parameters<LedgersService['getGeneralLedger']>[1]);

  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The defect that made the book disagree with every other report in the product.
   *
   * `journal_entry_lines` carries no status of its own, so summing it without joining the entry
   * counts drafts, entries awaiting approval and annulled entries as though they were posted.
   */
  it('leaves unposted entries out of the ledger card', async () => {
    await sale('2026-03-10', 1_000);
    await sale('2026-03-11', 500, { post: false });

    const card = await cardFor();

    expect(card.lines).toHaveLength(1);
    expect(card.periodDebit).toBe(1_000);
    expect(card.finalBalance).toBe(1_000);
  });

  it('includes them when the caller asks for them explicitly', async () => {
    await sale('2026-03-10', 1_000);
    await sale('2026-03-11', 500, { post: false });

    const card = await cardFor({ includeUnposted: true });

    expect(card.lines).toHaveLength(2);
    expect(card.periodDebit).toBe(1_500);
  });

  /**
   * The reference is the consecutive entry number.
   *
   * It printed `JE-` plus the first eight characters of the entry's uuid — years after consecutive
   * numbering landed — which is not a reference anyone can look an entry up by, and in most of this
   * product's markets a book of legal record has to carry the consecutive number.
   */
  it('references the entry by its consecutive number', async () => {
    const entry = await sale('2026-03-10', 1_000);
    const card = await cardFor();

    expect(card.lines[0].reference).toBe(entry.entryNumber);
    expect(card.lines[0].reference).not.toMatch(/^JE-/);
    expect(card.lines[0].journalCode).toBe('GENERAL');
  });

  /** A ledger card is read in the account's natural sense, not as `debit − credit`. */
  it('runs the balance in the account nature, for both natures', async () => {
    await sale('2026-03-10', 1_000);
    await sale('2026-03-20', 400);

    const cash = await cardFor();
    expect(cash.lines.map((line) => line.balance)).toEqual([1_000, 1_400]);

    const revenue = await ledgers.getGeneralLedger(organizationId, {
      accountId: account['revenue'],
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    // A credit-natured account grows with credits rather than reading negative.
    expect(revenue.lines.map((line) => line.balance)).toEqual([1_000, 1_400]);
    expect(revenue.periodCredit).toBe(1_400);
  });

  it('opens with the balance carried from before the period and closes with the balance at the end', async () => {
    await sale('2026-01-15', 700);
    await sale('2026-03-10', 300);

    const card = await ledgers.getGeneralLedger(organizationId, {
      accountId: account['cash'],
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });

    expect(card.initialBalance).toBe(700);
    expect(card.lines).toHaveLength(1);
    expect(card.finalBalance).toBe(1_000);
  });

  /**
   * Paging without breaking the running balance.
   *
   * The old implementation loaded every line the account had ever carried into memory. Paging it
   * naively is worse than not paging: page 2 would restart the running balance from the opening
   * figure and every balance on it would be wrong.
   */
  it('carries the running balance across pages', async () => {
    for (let day = 1; day <= 5; day += 1) {
      await sale(`2026-04-0${day}`, 100);
    }

    const first = await cardFor({ page: 1, pageSize: 2 });
    const second = await cardFor({ page: 2, pageSize: 2 });
    const third = await cardFor({ page: 3, pageSize: 2 });

    expect(first.lines.map((l) => l.balance)).toEqual([100, 200]);
    expect(second.lines.map((l) => l.balance)).toEqual([300, 400]);
    expect(third.lines.map((l) => l.balance)).toEqual([500]);

    expect(first.totalLines).toBe(5);
    expect(first.hasMore).toBe(true);
    expect(third.hasMore).toBe(false);
  });

  /**
   * Multi-GAAP. The card reads the per-ledger valuation, not `line.debit`.
   *
   * Without a `ledgerId` parameter — there was none — a tenant keeping a local book and an IFRS
   * book got the same figures for both, which is the entire point of keeping two.
   */
  it('reads the valuation of the ledger asked for', async () => {
    await post('2026-05-10', 'Venta con valuación NIIF distinta', [
      {
        accountId: account['cash'],
        debit: 1_000,
        valuations: [
          { ledgerId, debit: 1_000, credit: 0 },
          { ledgerId: secondaryLedgerId, debit: 900, credit: 0 },
        ],
      },
      {
        accountId: account['revenue'],
        credit: 1_000,
        valuations: [
          { ledgerId, debit: 0, credit: 1_000 },
          { ledgerId: secondaryLedgerId, debit: 0, credit: 900 },
        ],
      },
    ]);

    const primary = await cardFor({ ledgerId });
    const secondary = await cardFor({ ledgerId: secondaryLedgerId });

    expect(primary.lines[0].debit).toBe(1_000);
    expect(secondary.lines[0].debit).toBe(900);
    expect(secondary.ledger.id).toBe(secondaryLedgerId);
  });

  it('hands back the whole translation map for the account name', async () => {
    await sale('2026-03-10', 1_000);
    const card = await cardFor();
    expect(card.account.name).toEqual({ es: 'Efectivo', en: 'Efectivo' });
    expect(card.account.code).toBe('1101');
  });

  it('refuses a range that runs backwards', async () => {
    await expect(
      cardFor({ startDate: '2026-12-31', endDate: '2026-01-01' }),
    ).rejects.toThrow();
  });

  it('refuses an account belonging to another tenant', async () => {
    const other = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Otra ${Date.now()}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    try {
      await expect(
        ledgers.getGeneralLedger(other.id, {
          accountId: account['cash'],
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      ).rejects.toThrow();
    } finally {
      await dataSource.getRepository(Organization).delete({ id: other.id });
    }
  });

  // ── The daybook ────────────────────────────────────────────────────────────

  const daybook = (options: Partial<JournalReportDto> = {}) =>
    reports.generateJournalReport(organizationId, {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      ...options,
    } as JournalReportDto);

  it('leaves unposted entries out of the daybook too', async () => {
    await sale('2026-03-10', 1_000);
    await sale('2026-03-11', 500, { post: false });

    const report = await daybook();

    expect(report.entries).toHaveLength(1);
    expect(report.totalDebit).toBe(1_000);
    expect(report.totalCredit).toBe(1_000);
  });

  /**
   * `ledgerId` reaches the query.
   *
   * It was read as `(options as any).ledgerId` from a DTO that did not declare it — and the global
   * `ValidationPipe` runs with `whitelist: true`, so the property was stripped from the body before
   * the handler ever saw it. The cast made a compile error into a silent `undefined`.
   */
  it('reports the daybook of the ledger asked for', async () => {
    await post('2026-05-10', 'Venta con valuación NIIF distinta', [
      {
        accountId: account['cash'],
        debit: 1_000,
        valuations: [
          { ledgerId, debit: 1_000, credit: 0 },
          { ledgerId: secondaryLedgerId, debit: 900, credit: 0 },
        ],
      },
      {
        accountId: account['revenue'],
        credit: 1_000,
        valuations: [
          { ledgerId, debit: 0, credit: 1_000 },
          { ledgerId: secondaryLedgerId, debit: 0, credit: 900 },
        ],
      },
    ]);

    const primary = await daybook({ ledgerId });
    const secondary = await daybook({ ledgerId: secondaryLedgerId });

    expect(primary.totalDebit).toBe(1_000);
    expect(secondary.totalDebit).toBe(900);
  });

  it('pages the daybook by entry, not by line', async () => {
    for (let day = 1; day <= 4; day += 1) {
      await sale(`2026-06-0${day}`, 100);
    }

    const page = await daybook({ page: 1, pageSize: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.entries[0].lines).toHaveLength(2);
    expect(page.totalEntries).toBe(4);
    expect(page.hasMore).toBe(true);
  });

  it('refuses a daybook range that runs backwards', async () => {
    await expect(daybook({ startDate: '2026-12-31', endDate: '2026-01-01' })).rejects.toThrow();
  });
});
