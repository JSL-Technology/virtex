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
  AccountRole,
  AccountType,
} from '../chart-of-accounts/enums/account-enums';
import {
  AccountingPeriod,
  PeriodStatus,
  ModuleSlug,
} from './entities/accounting-period.entity';
import {
  JournalEntry,
  JournalEntryStatus,
} from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { FinancialReportingService } from '../financial-reporting/financial-reporting.service';
import { PeriodClosingService } from './period-closing.service';
import { AccountPeriodLock } from './entities/account-period-lock.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { toCents } from '../common/money';

/**
 * The accounting core, against a real PostgreSQL.
 *
 * These are the assertions that would have caught seven of the ten blocking defects in the audit:
 * the close that dropped every revenue account, the year-end close that could not balance, the
 * opening entry that doubled the balance sheet, the reports that read a column that did not exist,
 * the reports that counted drafts, the reopen that always failed, and the balance check that a
 * `NaN` walked through.
 *
 * Set `DB_HOST`/`DB_NAME` to point at a scratch database with the migrations applied. Without one
 * the suite skips rather than failing, so a contributor with no database still gets a green run —
 * but CI has one, and there the assertions below are the gate.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('the accounting core', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let entries: JournalEntriesService;
  let balances: AccountBalancesService;
  let reporting: FinancialReportingService;
  let closing: PeriodClosingService;

  let organizationId: string;
  let ledgerId: string;
  let generalJournalId: string;
  let closingJournalId: string;
  const account: Record<string, string> = {};
  let januaryId: string;
  let februaryId: string;

  const ACTOR = '11111111-1111-4111-8111-111111111111';
  const ctx = { actorUserId: ACTOR };

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
    balances = new AccountBalancesService(dataSource);
    reporting = new FinancialReportingService(dataSource, balances);

    // The collaborators that are not under test. The workflow stub returns null, which means "no
    // approval policy applies", so entries post directly — the path every subledger uses.
    const workflows = { startApprovalProcess: jest.fn().mockResolvedValue(null) };
    const saas = { enforceLimit: jest.fn().mockResolvedValue(undefined) };

    entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      workflows as never,
      new EventEmitter2(),
      saas as never,
      new JournalEntryNumberingService(),
      audit,
    );

    closing = new PeriodClosingService(
      dataSource.getRepository(AccountingPeriod),
      dataSource.getRepository(AccountPeriodLock),
      entries,
      balances,
      dataSource,
      audit,
      // Depreciation and revaluation are exercised by their own suites; the close's contract here
      // is that it runs them before reading balances, which the stub records.
      { runPreClosingTasks: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });

  afterAll(async () => {
    if (organizationId) {
      await dataSource
        .getRepository(Organization)
        .delete({ id: organizationId });
    }
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    // A fresh tenant per test. Cascades from `organizations` clear everything below it, so no test
    // can see another's postings and the assertions are about this book alone.
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Prueba ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

    const journals = await dataSource.getRepository(Journal).save([
      { organizationId, code: 'GENERAL', name: 'Diario general', type: 'GENERAL' as const },
      { organizationId, code: 'CIERRE', name: 'Diario de cierre', type: 'GENERAL' as const },
    ]);
    generalJournalId = journals[0].id;
    closingJournalId = journals[1].id;

    const make = async (
      key: string,
      code: string,
      name: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
      systemRole: AccountRole | null = null,
    ) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code,
          name: { es: name },
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

    await make('cash', '1101', 'Efectivo', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.CASH);
    await make('receivable', '1201', 'Cuentas por cobrar', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.ACCOUNTS_RECEIVABLE);
    await make('equipment', '1501', 'Equipos', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.DEBIT);
    await make('payable', '2101', 'Cuentas por pagar', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, AccountNature.CREDIT, AccountRole.ACCOUNTS_PAYABLE);
    await make('loan', '2501', 'Préstamo a largo plazo', AccountType.LIABILITY, AccountCategory.NON_CURRENT_LIABILITY, AccountNature.CREDIT);
    await make('capital', '3101', 'Capital social', AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, AccountNature.CREDIT);
    await make('retained', '3201', 'Resultados acumulados', AccountType.EQUITY, AccountCategory.RETAINED_EARNINGS, AccountNature.CREDIT, AccountRole.RETAINED_EARNINGS);
    await make('revenue', '4101', 'Ingresos por ventas', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.CREDIT, AccountRole.SALES_REVENUE);
    await make('returns', '4901', 'Devoluciones sobre ventas', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.DEBIT);
    await make('expense', '5101', 'Gastos operativos', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await make('forex', '5901', 'Diferencia cambiaria', AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, AccountNature.DEBIT, AccountRole.FOREX_GAIN_LOSS);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultRetainedEarningsAccountId: account['retained'],
        defaultForexGainLossAccountId: account['forex'],
      }),
    );

    const periods = await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Enero 2026', startDate: '2026-01-01' as unknown as Date, endDate: '2026-01-31' as unknown as Date, status: PeriodStatus.OPEN },
      { organizationId, name: 'Febrero 2026', startDate: '2026-02-01' as unknown as Date, endDate: '2026-02-28' as unknown as Date, status: PeriodStatus.OPEN },
    ]);
    januaryId = periods[0].id;
    februaryId = periods[1].id;
  });

  afterEach(async () => {
    await dataSource
      .getRepository(Organization)
      .delete({ id: organizationId });
  });

  const post = (
    date: string,
    description: string,
    lines: { accountId: string; debit?: number; credit?: number }[],
    journalId = generalJournalId,
  ): Promise<JournalEntry> =>
    entries.create(
      {
        date,
        description,
        journalId,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
        })),
      } as CreateJournalEntryDto,
      organizationId,
      ctx,
    );

  // ─────────────────────────────────────────────────────────────────────────
  describe('posting invariants', () => {
    it('posts a balanced entry and gives it a consecutive number', async () => {
      const entry = await post('2026-01-15', 'Venta de contado', [
        { accountId: account['cash'], debit: 1180 },
        { accountId: account['revenue'], credit: 1180 },
      ]);

      expect(entry.status).toBe(JournalEntryStatus.POSTED);
      expect(entry.entryNumber).toBe('GENERAL-2026-000001');
      expect(entry.postedByUserId).toBe(ACTOR);
      expect(entry.postedAt).toBeInstanceOf(Date);
    });

    it('numbers consecutively per journal and year, without gaps', async () => {
      const first = await post('2026-01-10', 'Uno', [
        { accountId: account['cash'], debit: 100 },
        { accountId: account['revenue'], credit: 100 },
      ]);
      const second = await post('2026-01-11', 'Dos', [
        { accountId: account['cash'], debit: 200 },
        { accountId: account['revenue'], credit: 200 },
      ]);
      // A different journal keeps its own series.
      const other = await post(
        '2026-01-12',
        'Tres',
        [
          { accountId: account['cash'], debit: 300 },
          { accountId: account['revenue'], credit: 300 },
        ],
        closingJournalId,
      );

      expect([first.entryNumber, second.entryNumber]).toEqual([
        'GENERAL-2026-000001',
        'GENERAL-2026-000002',
      ]);
      expect(other.entryNumber).toBe('CIERRE-2026-000001');
    });

    it('rejects an entry that does not balance, to the cent', async () => {
      await expect(
        post('2026-01-15', 'Descuadrado por un centavo', [
          { accountId: account['cash'], debit: 100.0 },
          { accountId: account['revenue'], credit: 99.99 },
        ]),
      ).rejects.toThrow();
    });

    it('rejects an amount that is not a number, rather than treating NaN as balanced', async () => {
      await expect(
        post('2026-01-15', 'Importe corrupto', [
          { accountId: account['cash'], debit: '01500.00200.00' as unknown as number },
          { accountId: account['revenue'], credit: 1500 },
        ]),
      ).rejects.toThrow();
    });

    it('rejects a line carrying both a debit and a credit', async () => {
      await expect(
        post('2026-01-15', 'Línea ambigua', [
          { accountId: account['cash'], debit: 100, credit: 100 },
          { accountId: account['revenue'], credit: 100 },
          { accountId: account['expense'], debit: 100 },
        ]),
      ).rejects.toThrow();
    });

    it('refuses to post into a closed period', async () => {
      await dataSource
        .getRepository(AccountingPeriod)
        .update({ id: januaryId }, { status: PeriodStatus.CLOSED });

      await expect(
        post('2026-01-15', 'Tarde', [
          { accountId: account['cash'], debit: 100 },
          { accountId: account['revenue'], credit: 100 },
        ]),
      ).rejects.toThrow();
    });

    it('refuses to post when the subledger window is closed, even if the period is open', async () => {
      // These four statuses existed and nothing read them.
      await closing.closeModulePeriod(januaryId, ModuleSlug.AP, organizationId, ACTOR);

      await expect(
        entries.create(
          {
            date: '2026-01-15',
            description: 'Factura de proveedor tardía',
            journalId: generalJournalId,
            lines: [
              { accountId: account['expense'], debit: 100, credit: 0 },
              { accountId: account['payable'], debit: 0, credit: 100 },
            ],
          } as CreateJournalEntryDto,
          organizationId,
          { actorUserId: ACTOR, module: ModuleSlug.AP },
        ),
      ).rejects.toThrow();
    });

    it('writes an audit row in the same transaction as the entry', async () => {
      const entry = await post('2026-01-15', 'Con rastro', [
        { accountId: account['cash'], debit: 100 },
        { accountId: account['revenue'], credit: 100 },
      ]);

      const logs = await dataSource.getRepository(AuditLog).find({
        where: { entity: 'journal_entries', entityId: entry.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].userId).toBe(ACTOR);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('derived balances', () => {
    it('counts posted entries and ignores drafts', async () => {
      await post('2026-01-10', 'Contabilizado', [
        { accountId: account['cash'], debit: 1000 },
        { accountId: account['revenue'], credit: 1000 },
      ]);

      // A draft with its lines persisted — the shape that used to pollute every report.
      const draft = await dataSource.getRepository(JournalEntry).save(
        dataSource.getRepository(JournalEntry).create({
          organizationId,
          ledgerId,
          journalId: generalJournalId,
          date: '2026-01-11' as unknown as Date,
          description: 'Borrador',
          status: JournalEntryStatus.DRAFT,
          lines: [
            { accountId: account['cash'], debit: 9999, credit: 0, valuations: [{ ledgerId, debit: 9999, credit: 0 }] },
            { accountId: account['revenue'], debit: 0, credit: 9999, valuations: [{ ledgerId, debit: 0, credit: 9999 }] },
          ],
        } as never),
      );
      expect(draft).toBeDefined();

      const asOf = await balances.balancesAsOf({
        organizationId,
        ledgerId,
        asOf: '2026-01-31',
      });
      expect(asOf.get(account['cash'])).toBe(1000);
      expect(asOf.get(account['revenue'])).toBe(-1000);
    });

    it('is visible inside the transaction that posted it', async () => {
      // The close depends on this: it posts depreciation and revaluation, then reads balances that
      // must already include them. Under the old queue-based balances they could not.
      await dataSource.transaction(async (manager) => {
        await entries.createWithManager(
          manager,
          {
            date: '2026-01-20',
            description: 'Dentro de la transacción',
            journalId: generalJournalId,
            lines: [
              { accountId: account['expense'], debit: 500, credit: 0 },
              { accountId: account['cash'], debit: 0, credit: 500 },
            ],
          } as CreateJournalEntryDto,
          organizationId,
          ctx,
        );

        const inside = await balances.balancesAsOf(
          { organizationId, ledgerId, asOf: '2026-01-31' },
          manager,
        );
        expect(inside.get(account['expense'])).toBe(500);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('closing a period', () => {
    beforeEach(async () => {
      // Revenue 5,000; a sales return of 200 (a debit balance inside revenue); expenses 3,000.
      await post('2026-01-05', 'Venta', [
        { accountId: account['receivable'], debit: 5000 },
        { accountId: account['revenue'], credit: 5000 },
      ]);
      await post('2026-01-06', 'Devolución', [
        { accountId: account['returns'], debit: 200 },
        { accountId: account['receivable'], credit: 200 },
      ]);
      await post('2026-01-20', 'Gastos del mes', [
        { accountId: account['expense'], debit: 3000 },
        { accountId: account['cash'], credit: 3000 },
      ]);
    });

    it('closes revenue — the account the old close silently dropped', async () => {
      await closing.closePeriod(januaryId, organizationId, ACTOR);

      const after = await balances.balancesAsOf({
        organizationId,
        ledgerId,
        asOf: '2026-01-31',
      });
      expect(after.get(account['revenue']) ?? 0).toBe(0);
      expect(after.get(account['returns']) ?? 0).toBe(0);
      expect(after.get(account['expense']) ?? 0).toBe(0);
    });

    it('moves the real result to retained earnings', async () => {
      await closing.closePeriod(januaryId, organizationId, ACTOR);

      const after = await balances.balancesAsOf({
        organizationId,
        ledgerId,
        asOf: '2026-01-31',
      });
      // Revenue 5,000 − returns 200 − expenses 3,000 = profit of 1,800, credited to equity.
      expect(after.get(account['retained'])).toBe(-1800);
    });

    it('does not re-post balance-sheet balances into the next period', async () => {
      const cashBefore = (
        await balances.balancesAsOf({ organizationId, ledgerId, asOf: '2026-01-31' })
      ).get(account['cash']);

      await closing.closePeriod(januaryId, organizationId, ACTOR);

      const cashAfter = (
        await balances.balancesAsOf({ organizationId, ledgerId, asOf: '2026-02-28' })
      ).get(account['cash']);

      // The old close posted an opening entry re-stating every balance-sheet account, which the
      // balance worker then added to the balance it was carrying: cash doubled at every close.
      expect(cashAfter).toBe(cashBefore);
    });

    it('refuses to close while an earlier period is still open', async () => {
      await expect(
        closing.closePeriod(februaryId, organizationId, ACTOR),
      ).rejects.toThrow();
    });

    it('refuses to close with unposted entries in the period', async () => {
      await dataSource.getRepository(JournalEntry).save(
        dataSource.getRepository(JournalEntry).create({
          organizationId,
          ledgerId,
          journalId: generalJournalId,
          date: '2026-01-25' as unknown as Date,
          description: 'Pendiente',
          status: JournalEntryStatus.PENDING_APPROVAL,
        } as never),
      );

      await expect(
        closing.closePeriod(januaryId, organizationId, ACTOR),
      ).rejects.toThrow();
    });

    it('reopens a closed period and reverses the closing entry', async () => {
      await closing.closePeriod(januaryId, organizationId, ACTOR);

      // The reopen used to post the reversal before setting the period open, so posting refused it
      // and the whole operation rolled back — every time.
      const reopened = await closing.reopenPeriod(
        { periodId: januaryId, reason: 'Ajuste de auditoría' },
        organizationId,
        ACTOR,
      );
      expect(reopened.status).toBe(PeriodStatus.OPEN);

      const after = await balances.balancesAsOf({
        organizationId,
        ledgerId,
        asOf: '2026-01-31',
      });
      // The result accounts carry their balances again, and equity is back where it started.
      expect(after.get(account['revenue'])).toBe(-5000);
      expect(after.get(account['retained']) ?? 0).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('the financial statements', () => {
    beforeEach(async () => {
      await post('2026-01-02', 'Aporte de capital', [
        { accountId: account['cash'], debit: 100_000 },
        { accountId: account['capital'], credit: 100_000 },
      ]);
      await post('2026-01-03', 'Préstamo bancario', [
        { accountId: account['cash'], debit: 50_000 },
        { accountId: account['loan'], credit: 50_000 },
      ]);
      await post('2026-01-04', 'Compra de equipo', [
        { accountId: account['equipment'], debit: 30_000 },
        { accountId: account['cash'], credit: 30_000 },
      ]);
      await post('2026-01-10', 'Venta a crédito', [
        { accountId: account['receivable'], debit: 20_000 },
        { accountId: account['revenue'], credit: 20_000 },
      ]);
      await post('2026-01-15', 'Cobro parcial', [
        { accountId: account['cash'], debit: 12_000 },
        { accountId: account['receivable'], credit: 12_000 },
      ]);
      await post('2026-01-25', 'Gastos pagados', [
        { accountId: account['expense'], debit: 7_000 },
        { accountId: account['cash'], credit: 7_000 },
      ]);
    });

    it('produces a balance sheet where assets equal liabilities plus equity', async () => {
      const sheet = await reporting.getBalanceSheet(organizationId, '2026-01-31');

      expect(sheet.isBalanced).toBe(true);
      expect(sheet.outOfBalanceBy).toBe(0);
      expect(sheet.assets.total).toBe(sheet.totalLiabilitiesAndEquity);
      // 100,000 + 50,000 − 30,000 + 12,000 − 7,000 = 125,000 cash; 8,000 receivable; 30,000 equipment.
      expect(sheet.assets.total).toBe(163_000);
      // Unclosed result: revenue 20,000 − expenses 7,000.
      expect(sheet.equity.unclosedResult).toBe(13_000);
    });

    it('still balances after the period is closed', async () => {
      await closing.closePeriod(januaryId, organizationId, ACTOR);
      const sheet = await reporting.getBalanceSheet(organizationId, '2026-01-31');

      expect(sheet.isBalanced).toBe(true);
      // The result has moved to retained earnings, so there is nothing unclosed left.
      expect(sheet.equity.unclosedResult).toBe(0);
      expect(sheet.assets.total).toBe(163_000);
    });

    it('produces an income statement with the right result', async () => {
      const statement = await reporting.getIncomeStatement(
        organizationId,
        '2026-01-01',
        '2026-01-31',
      );
      expect(statement.revenue.total).toBe(20_000);
      expect(statement.operatingExpenses.total).toBe(7_000);
      expect(statement.netIncome).toBe(13_000);
    });

    it('produces a trial balance whose debits equal its credits', async () => {
      const trial = await reporting.getTrialBalance(
        organizationId,
        '2026-01-01',
        '2026-01-31',
      );

      expect(trial.isBalanced).toBe(true);
      expect(toCents(trial.totals.periodDebit)).toBe(toCents(trial.totals.periodCredit));
      expect(toCents(trial.totals.closingDebit)).toBe(toCents(trial.totals.closingCredit));
      expect(trial.rows.length).toBeGreaterThan(0);
    });

    it('produces a cash flow statement that ties to the movement in cash', async () => {
      const flow = await reporting.getCashFlowStatement(
        organizationId,
        '2026-01-01',
        '2026-01-31',
      );

      expect(flow.openingCash).toBe(0);
      expect(flow.closingCash).toBe(125_000);
      // Derived from the movement of every non-cash account, so this is an identity, not an
      // estimate. The previous statement never compared its total to cash at all.
      expect(flow.unexplainedDifference).toBe(0);
      expect(flow.openingCash + flow.netChangeInCash).toBe(flow.closingCash);
      // Capital and the loan are financing; the equipment is investing.
      expect(flow.financing.total).toBe(150_000);
      expect(flow.investing.total).toBe(-30_000);
    });

    it('ties over a period that opens with a balance carried forward', async () => {
      await post('2026-02-05', 'Gasto de febrero', [
        { accountId: account['expense'], debit: 4_000 },
        { accountId: account['cash'], credit: 4_000 },
      ]);

      const february = await reporting.getCashFlowStatement(
        organizationId,
        '2026-02-01',
        '2026-02-28',
      );
      expect(february.openingCash).toBe(125_000);
      expect(february.closingCash).toBe(121_000);
      expect(february.unexplainedDifference).toBe(0);
    });
  });
});
