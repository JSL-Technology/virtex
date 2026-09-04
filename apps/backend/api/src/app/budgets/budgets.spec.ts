import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
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
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { Budget } from './entities/budget.entity';
import { BudgetLine } from './entities/budget-line.entity';
import { BudgetControlService } from './budget-control.service';
import { BudgetsService } from './budgets.service';

/**
 * Budget control.
 *
 * The control existed and could be walked around in four separate ways, each of which turns it
 * from a limit into a suggestion.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('budget control', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let entries: JournalEntriesService;
  let control: BudgetControlService;
  let budgets: BudgetsService;

  let organizationId: string;
  let ledgerId: string;
  let journalId: string;
  const account: Record<string, string> = {};

  const ACTOR = '77777777-7777-4777-8777-777777777777';
  const ctx = { actorUserId: ACTOR };
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

    control = new BudgetControlService(
      dataSource.getRepository(Budget),
      dataSource.getRepository(JournalEntryLine),
      dataSource.getRepository(Ledger),
    );
    budgets = new BudgetsService(
      dataSource.getRepository(Budget),
      dataSource.getRepository(JournalEntryLine),
      dataSource.getRepository(Ledger),
    );

    entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      {
        startApprovalProcess: jest.fn(async () =>
          approvalRequired ? { id: 'approval-request' } : null,
        ),
      } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      new AuditTrailService(dataSource.getRepository(AuditLog)),
      control,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    approvalRequired = false;
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Presupuesto ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    const ledger = await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({
        organizationId,
        name: 'Libro principal',
        currency: 'DOP',
        isDefault: true,
        isActive: true,
      }),
    );
    ledgerId = ledger.id;

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
          name: { es: label },
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
    await make('expense', '5101', 'Gastos de mercadeo', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
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

  /** A budget for one month with one line on the marketing expense account. */
  async function budgetOf(
    period: string,
    amount: number,
    options: { accountKey?: string; dimensions?: Record<string, string> } = {},
  ): Promise<Budget> {
    const budget = await dataSource.getRepository(Budget).save(
      dataSource.getRepository(Budget).create({
        organizationId,
        name: `Presupuesto ${period}`,
        period,
      }),
    );
    await dataSource.getRepository(BudgetLine).save(
      dataSource.getRepository(BudgetLine).create({
        budgetId: budget.id,
        accountId: account[options.accountKey ?? 'expense'],
        amount,
        dimensions: options.dimensions ?? {},
      }),
    );
    return budget;
  }

  const spend = async (date: string, amount: number, options: { post?: boolean } = {}) => {
    approvalRequired = options.post === false;
    try {
      return await entries.create(
        {
          date,
          description: `Gasto ${date}`,
          journalId,
          lines: [
            { accountId: account['expense'], debit: amount, credit: 0 },
            { accountId: account['cash'], debit: 0, credit: amount },
          ],
        } as unknown as CreateJournalEntryDto,
        organizationId,
        ctx,
      );
    } finally {
      approvalRequired = false;
    }
  };

  // ───────────────────────────────────────────────────────────────────────────

  /**
   * A draft is a proposal, not spend.
   *
   * The actuals query joined the entry without filtering its status, so a draft or an annulled
   * entry consumed budget exactly like a posted one — and reversing an annulled entry did not give
   * the budget back, because the annulment and its reversal were both counted.
   */
  it('counts only posted entries as spend', async () => {
    await budgetOf('2026-03', 1_000);
    await spend('2026-03-05', 900, { post: false });

    const check = await control.checkBudget(organizationId, account['expense'], 200, '2026-03-10');

    expect(check.actualAmount).toBe(0);
    expect(check.isExceeded).toBe(false);
  });

  it('counts posted entries as spend', async () => {
    await budgetOf('2026-03', 1_000);
    await spend('2026-03-05', 900);

    const check = await control.checkBudget(organizationId, account['expense'], 200, '2026-03-10');

    expect(check.actualAmount).toBe(900);
    expect(check.isExceeded).toBe(true);
    expect(check.variance).toBe(100);
  });

  /**
   * The month a posting belongs to, in UTC.
   *
   * The key came from `transactionDate.getFullYear()`/`getMonth()` and the range from date-fns
   * `startOfMonth`/`endOfMonth`, all of which read local time. A `date` column arrives as midnight
   * UTC, so on any server west of Greenwich the first of the month resolved to the previous one:
   * the March budget was never consulted for 1 March, and the February budget was charged instead.
   */
  it('reads the first day of the month against that month, not the previous one', async () => {
    await budgetOf('2026-02', 10);
    await budgetOf('2026-03', 1_000);

    const check = await control.checkBudget(organizationId, account['expense'], 500, '2026-03-01');

    expect(check.budgetName).toBe('Presupuesto 2026-03');
    expect(check.isExceeded).toBe(false);
  });

  it('reads the last day of the month against that month', async () => {
    await budgetOf('2026-03', 1_000);
    await budgetOf('2026-04', 10);

    const check = await control.checkBudget(organizationId, account['expense'], 500, '2026-03-31');

    expect(check.budgetName).toBe('Presupuesto 2026-03');
    expect(check.isExceeded).toBe(false);
  });

  it('sums only the movements inside the budget month', async () => {
    await budgetOf('2026-03', 1_000);
    await spend('2026-02-28', 900);
    await spend('2026-03-15', 100);
    await spend('2026-04-01', 900);

    const check = await control.checkBudget(organizationId, account['expense'], 0, '2026-03-20');
    expect(check.actualAmount).toBe(100);
  });

  /**
   * A revenue budget is a target to reach, read in credit sense.
   *
   * `SUM(debit − credit)` is the natural sense of a debit account and the inverse of a revenue
   * account's, so a revenue budget compared a negative actual against a positive target and could
   * never register as consumed at all.
   */
  it('reads a revenue budget in its own natural sense', async () => {
    await budgetOf('2026-03', 5_000, { accountKey: 'revenue' });

    await entries.create(
      {
        date: '2026-03-10',
        description: 'Venta',
        journalId,
        lines: [
          { accountId: account['cash'], debit: 4_000, credit: 0 },
          { accountId: account['revenue'], debit: 0, credit: 4_000 },
        ],
      } as unknown as CreateJournalEntryDto,
      organizationId,
      ctx,
    );

    const check = await control.checkBudget(organizationId, account['revenue'], 0, '2026-03-20');
    expect(check.actualAmount).toBe(4_000);
    expect(check.variance).toBe(1_000);
  });

  /**
   * The control reaches the journal, not only accounts payable.
   *
   * `checkBudget` had exactly one caller — submitting a supplier bill — so the same expense typed
   * straight into the journal went through untouched. A limit anyone can step around by using the
   * next screen is not a limit.
   */
  it('refuses a manual journal entry that would exceed the budget', async () => {
    await budgetOf('2026-03', 1_000);
    await spend('2026-03-05', 900);

    await expect(spend('2026-03-10', 200)).rejects.toThrow();
  });

  it('allows a manual journal entry that fits', async () => {
    await budgetOf('2026-03', 1_000);
    await spend('2026-03-05', 900);

    await expect(spend('2026-03-10', 100)).resolves.toBeDefined();
  });

  /** A credit to a budgeted expense account gives budget back; it must never be refused. */
  it('does not refuse an entry that releases budget', async () => {
    await budgetOf('2026-03', 1_000);
    await spend('2026-03-05', 1_000);

    await expect(
      entries.create(
        {
          date: '2026-03-10',
          description: 'Devolución de gasto',
          journalId,
          lines: [
            { accountId: account['cash'], debit: 300, credit: 0 },
            { accountId: account['expense'], debit: 0, credit: 300 },
          ],
        } as unknown as CreateJournalEntryDto,
        organizationId,
        ctx,
      ),
    ).resolves.toBeDefined();
  });

  it('does not consult the budget for an account nobody budgeted', async () => {
    await budgetOf('2026-03', 1);

    const check = await control.checkBudget(organizationId, account['cash'], 999_999, '2026-03-10');
    expect(check.isExceeded).toBe(false);
    expect(check.messageKey).toBe('BUDGETS.CUENTA_SUS_DIMENSIONES_NO_ESTAN_PRESUPUESTADAS');
  });

  it('does not consult a month with no budget', async () => {
    const check = await control.checkBudget(
      organizationId,
      account['expense'],
      999_999,
      '2026-07-10',
    );
    expect(check.isExceeded).toBe(false);
  });

  /** A dimensional line controls its own cost centre; the account-level line controls the rest. */
  it('prefers the dimensional line over the account-level one', async () => {
    const budget = await budgetOf('2026-03', 5_000);
    await dataSource.getRepository(BudgetLine).save(
      dataSource.getRepository(BudgetLine).create({
        budgetId: budget.id,
        accountId: account['expense'],
        amount: 100,
        dimensions: { COST_CENTER: 'MERCADEO' },
      }),
    );

    const dimensional = await control.checkBudget(
      organizationId,
      account['expense'],
      500,
      '2026-03-10',
      { COST_CENTER: 'MERCADEO' },
    );
    const overall = await control.checkBudget(
      organizationId,
      account['expense'],
      500,
      '2026-03-10',
    );

    expect(dimensional.isExceeded).toBe(true);
    expect(dimensional.budgetedAmount).toBe(100);
    expect(overall.isExceeded).toBe(false);
    expect(overall.budgetedAmount).toBe(5_000);
  });

  // ── The comparison report ─────────────────────────────────────────────────

  /**
   * `getBudgetVsActualReport` existed and no route reached it.
   *
   * The controller offered create, list, read, update and delete. A budget nobody can compare
   * against reality is a list of numbers.
   */
  it('compares budget against actuals over the budget month by default', async () => {
    const budget = await budgetOf('2026-03', 1_000);
    await spend('2026-03-05', 400);
    await spend('2026-02-20', 900);

    const report = await budgets.getBudgetVsActualReport(budget.id, organizationId);

    expect(report.period).toEqual({ startDate: '2026-03-01', endDate: '2026-03-31' });
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0].actualAmount).toBe(400);
    expect(report.lines[0].difference).toBe(600);
    expect(report.lines[0].consumedRatio).toBe(0.4);
    expect(report.totals).toEqual({ budgeted: 1_000, actual: 400, difference: 600 });
    expect(report.ledger?.id).toBe(ledgerId);
  });

  it('leaves unposted entries out of the comparison too', async () => {
    const budget = await budgetOf('2026-03', 1_000);
    await spend('2026-03-05', 400, { post: false });

    const report = await budgets.getBudgetVsActualReport(budget.id, organizationId);
    expect(report.lines[0].actualAmount).toBe(0);
  });

  it('refuses a comparison range that runs backwards', async () => {
    const budget = await budgetOf('2026-03', 1_000);
    await expect(
      budgets.getBudgetVsActualReport(budget.id, organizationId, {
        startDate: '2026-03-31',
        endDate: '2026-03-01',
      }),
    ).rejects.toThrow();
  });

  // ── Integrity ──────────────────────────────────────────────────────────────

  /**
   * One budget per tenant per month.
   *
   * There was no constraint, so `findOne` returned whichever row PostgreSQL produced and the
   * control enforced an arbitrary one of two budgets — a choice that can change between two
   * identical requests.
   */
  it('refuses a second budget for the same month', async () => {
    await budgetOf('2026-03', 1_000);
    await expect(budgetOf('2026-03', 9_000)).rejects.toThrow();
  });

  it('refuses a period that is not a calendar month', async () => {
    await expect(
      dataSource.getRepository(Budget).save(
        dataSource.getRepository(Budget).create({
          organizationId,
          name: 'Mal formado',
          period: '2026-3',
        }),
      ),
    ).rejects.toThrow();
  });

  it('refuses a second line for the same account and dimensions', async () => {
    const budget = await budgetOf('2026-03', 1_000);
    await expect(
      dataSource.getRepository(BudgetLine).save(
        dataSource.getRepository(BudgetLine).create({
          budgetId: budget.id,
          accountId: account['expense'],
          amount: 500,
          dimensions: {},
        }),
      ),
    ).rejects.toThrow();
  });
});
