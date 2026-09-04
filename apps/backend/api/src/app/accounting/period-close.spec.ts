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
import { AccountingPeriod, PeriodStatus } from './entities/accounting-period.entity';
import {
  JournalEntry,
  JournalEntryStatus,
  JournalEntryType,
} from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { FinancialReportingService } from '../financial-reporting/financial-reporting.service';
import { PeriodClosingService } from './period-closing.service';
import { YearEndCloseService } from './year-end-close.service';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { AccountPeriodLock } from './entities/account-period-lock.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { ClosingAutomationService } from './closing-automation.service';
import { ResultTransferService } from './result-transfer.service';
import { DepreciationService } from '../fixed-assets/depreciation.service';
import { CurrencyRevaluationService } from '../batch-processes/currency-revaluation.service';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { FixedAsset, FixedAssetStatus } from '../fixed-assets/entities/fixed-asset.entity';

/**
 * The period close, end to end, with the real pre-closing services.
 *
 * ## Why this suite exists separately from `ledger-integrity.spec.ts`
 *
 * That suite constructs `PeriodClosingService` with
 * `{ runPreClosingTasks: jest.fn().mockResolvedValue(undefined) }` in place of
 * `ClosingAutomationService`. Its assertions about closing are therefore assertions about a close
 * that skips depreciation and revaluation — and the close, in production, **never got past them**:
 * `ClosingAutomationService` handed `period.endDate` to the depreciation run, which called
 * `getUTCFullYear()` on what is a string at run time, and every close in every tenant died with
 * `date.getUTCFullYear is not a function`.
 *
 * A stub is the right call when the collaborator is exercised elsewhere. It was not exercised
 * anywhere. So this suite wires the real `DepreciationService`, `CurrencyRevaluationService` and
 * `SchedulerLockService` and closes a period with an asset on the books — which is the shape of the
 * failure, and the only shape that would have caught it.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('closing a period, with the pre-closing tasks that actually run', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let entries: JournalEntriesService;
  let balances: AccountBalancesService;
  let reporting: FinancialReportingService;
  let closing: PeriodClosingService;
  let yearEnd: YearEndCloseService;

  let organizationId: string;
  let ledgerId: string;
  let generalJournalId: string;
  const account: Record<string, string> = {};
  let januaryId: string;
  let februaryId: string;
  let fiscalYearId: string;

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

    const schedulerLock = new SchedulerLockService(dataSource);
    const depreciation = new DepreciationService(entries, schedulerLock, dataSource);
    const revaluation = new CurrencyRevaluationService(entries, balances, dataSource);

    closing = new PeriodClosingService(
      dataSource.getRepository(AccountingPeriod),
      dataSource.getRepository(AccountPeriodLock),
      entries,
      balances,
      dataSource,
      audit,
      new ClosingAutomationService(depreciation, revaluation),
    );
    yearEnd = new YearEndCloseService(
      dataSource,
      audit,
      new ResultTransferService(entries, balances),
      entries,
    );
  });

  afterAll(async () => {
    if (organizationId) {
      await dataSource.getRepository(Organization).delete({ id: organizationId });
    }
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Cierre ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      { organizationId, code: 'DEPREC', name: 'Diario de depreciación', type: 'GENERAL' as const },
    ]);
    generalJournalId = journals[0].id;

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
    await make('equipment', '1501', 'Equipos', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.DEBIT);
    await make('accumulated', '1591', 'Depreciación acumulada', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.CREDIT, AccountRole.ACCUMULATED_DEPRECIATION);
    await make('retained', '3201', 'Resultados acumulados', AccountType.EQUITY, AccountCategory.RETAINED_EARNINGS, AccountNature.CREDIT, AccountRole.RETAINED_EARNINGS);
    await make('revenue', '4101', 'Ingresos por ventas', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.CREDIT, AccountRole.SALES_REVENUE);
    await make('expense', '5101', 'Gastos operativos', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await make('depreciation', '5201', 'Gasto por depreciación', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT, AccountRole.DEPRECIATION_EXPENSE);
    await make('forex', '5901', 'Diferencia cambiaria', AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, AccountNature.DEBIT, AccountRole.FOREX_GAIN_LOSS);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultRetainedEarningsAccountId: account['retained'],
        defaultForexGainLossAccountId: account['forex'],
        defaultDepreciationExpenseAccountId: account['depreciation'],
        defaultAccumulatedDepreciationAccountId: account['accumulated'],
      }),
    );

    const periods = await dataSource.getRepository(AccountingPeriod).save([
      { organizationId, name: 'Enero 2026', startDate: '2026-01-01' as unknown as Date, endDate: '2026-01-31' as unknown as Date, status: PeriodStatus.OPEN },
      { organizationId, name: 'Febrero 2026', startDate: '2026-02-01' as unknown as Date, endDate: '2026-02-28' as unknown as Date, status: PeriodStatus.OPEN },
    ]);
    januaryId = periods[0].id;
    februaryId = periods[1].id;

    const fy = await dataSource.getRepository(FiscalYear).save(
      dataSource.getRepository(FiscalYear).create({
        organizationId,
        startDate: '2026-01-01' as unknown as Date,
        endDate: '2026-02-28' as unknown as Date,
        status: FiscalYearStatus.OPEN,
      }),
    );
    fiscalYearId = fy.id;
  });

  afterEach(async () => {
    await dataSource.getRepository(Organization).delete({ id: organizationId });
  });

  const post = (
    date: string,
    description: string,
    lines: { accountId: string; debit?: number; credit?: number }[],
  ): Promise<JournalEntry> =>
    entries.create(
      {
        date,
        description,
        journalId: generalJournalId,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
        })),
      } as CreateJournalEntryDto,
      organizationId,
      ctx,
    );

  const addAsset = () =>
    dataSource.getRepository(FixedAsset).save(
      dataSource.getRepository(FixedAsset).create({
        organizationId,
        name: 'Servidor',
        description: 'Servidor de aplicaciones',
        cost: 120_000,
        residualValue: 0,
        accumulatedDepreciation: 0,
        bookValue: 120_000,
        usefulLife: 60,
        depreciationMethod: 'STRAIGHT_LINE',
        purchaseDate: '2025-12-01' as unknown as Date,
        status: FixedAssetStatus.IN_USE,
        assetAccountId: account['equipment'],
        accumulatedDepreciationAccountId: account['accumulated'],
      }),
    );

  // ─────────────────────────────────────────────────────────────────────────

  it('closes a period whose tenant has fixed assets, instead of throwing on the date', async () => {
    await addAsset();
    await post('2026-01-10', 'Venta', [
      { accountId: account['cash'], debit: 20_000 },
      { accountId: account['revenue'], credit: 20_000 },
    ]);

    await expect(
      closing.closePeriod(januaryId, organizationId, ACTOR),
    ).resolves.toMatchObject({ status: PeriodStatus.CLOSED });
  });

  it('posts the month of depreciation the close is responsible for', async () => {
    await addAsset();
    await post('2026-01-10', 'Venta', [
      { accountId: account['cash'], debit: 20_000 },
      { accountId: account['revenue'], credit: 20_000 },
    ]);

    await closing.closePeriod(januaryId, organizationId, ACTOR);

    // 120 000 over 60 months.
    const charge = await balances.balanceOf(account['depreciation'], {
      organizationId,
      ledgerId,
      asOf: '2026-01-31',
    });
    expect(charge).toBe(2_000);
  });

  it('does not charge the same month twice when the close runs after the scheduler', async () => {
    const depreciation = new DepreciationService(
      entries,
      new SchedulerLockService(dataSource),
      dataSource,
    );
    await addAsset();
    await post('2026-01-10', 'Venta', [
      { accountId: account['cash'], debit: 20_000 },
      { accountId: account['revenue'], credit: 20_000 },
    ]);

    await depreciation.runMonthlyDepreciation(organizationId, '2026-01-31');
    await closing.closePeriod(januaryId, organizationId, ACTOR);

    const charge = await balances.balanceOf(account['depreciation'], {
      organizationId,
      ledgerId,
      asOf: '2026-01-31',
    });
    expect(charge).toBe(2_000);
  });

  it('leaves the income statement of a closed month readable', async () => {
    await post('2026-01-10', 'Venta', [
      { accountId: account['cash'], debit: 20_000 },
      { accountId: account['revenue'], credit: 20_000 },
    ]);
    await post('2026-01-20', 'Gasto', [
      { accountId: account['expense'], debit: 7_000 },
      { accountId: account['cash'], credit: 7_000 },
    ]);

    await closing.closePeriod(januaryId, organizationId, ACTOR);

    const statement = await reporting.getIncomeStatement(
      organizationId,
      '2026-01-01',
      '2026-01-31',
    );
    expect(statement.revenue.total).toBe(20_000);
    expect(statement.operatingExpenses.total).toBe(7_000);
    expect(statement.netIncome).toBe(13_000);
  });

  it('leaves a year-to-date income statement readable across a closed month', async () => {
    await post('2026-01-10', 'Venta de enero', [
      { accountId: account['cash'], debit: 20_000 },
      { accountId: account['revenue'], credit: 20_000 },
    ]);
    await closing.closePeriod(januaryId, organizationId, ACTOR);
    await post('2026-02-10', 'Venta de febrero', [
      { accountId: account['cash'], debit: 5_000 },
      { accountId: account['revenue'], credit: 5_000 },
    ]);

    const statement = await reporting.getIncomeStatement(
      organizationId,
      '2026-01-01',
      '2026-02-28',
    );
    expect(statement.revenue.total).toBe(25_000);
    expect(statement.netIncome).toBe(25_000);
  });

  it('does not move the result to retained earnings on a monthly close', async () => {
    await post('2026-01-10', 'Venta', [
      { accountId: account['cash'], debit: 20_000 },
      { accountId: account['revenue'], credit: 20_000 },
    ]);
    await closing.closePeriod(januaryId, organizationId, ACTOR);

    const retained = await balances.balanceOf(account['retained'], {
      organizationId,
      ledgerId,
      asOf: '2026-01-31',
    });
    expect(retained).toBe(0);

    const closingEntries = await dataSource.getRepository(JournalEntry).count({
      where: { organizationId, entryType: JournalEntryType.CLOSING_ENTRY },
    });
    expect(closingEntries).toBe(0);
  });

  it('moves the result to retained earnings when the fiscal year closes', async () => {
    await post('2026-01-10', 'Venta', [
      { accountId: account['cash'], debit: 20_000 },
      { accountId: account['revenue'], credit: 20_000 },
    ]);
    await post('2026-02-10', 'Gasto', [
      { accountId: account['expense'], debit: 7_000 },
      { accountId: account['cash'], credit: 7_000 },
    ]);

    await closing.closePeriod(januaryId, organizationId, ACTOR);
    await closing.closePeriod(februaryId, organizationId, ACTOR);
    await yearEnd.closeFiscalYear({ fiscalYearId }, organizationId, ACTOR);

    // Signed: equity is negative under `debit − credit`, so a 13 000 profit reads as −13 000.
    const retained = await balances.balanceOf(account['retained'], {
      organizationId,
      ledgerId,
      asOf: '2026-02-28',
    });
    expect(retained).toBe(-13_000);

    // And the profit-and-loss accounts are back to zero.
    const revenue = await balances.balanceOf(account['revenue'], {
      organizationId,
      ledgerId,
      asOf: '2026-02-28',
    });
    expect(revenue).toBe(0);
  });

  it('still reports the closed year’s income statement after the annual close', async () => {
    await post('2026-01-10', 'Venta', [
      { accountId: account['cash'], debit: 20_000 },
      { accountId: account['revenue'], credit: 20_000 },
    ]);
    await closing.closePeriod(januaryId, organizationId, ACTOR);
    await closing.closePeriod(februaryId, organizationId, ACTOR);
    await yearEnd.closeFiscalYear({ fiscalYearId }, organizationId, ACTOR);

    const statement = await reporting.getIncomeStatement(
      organizationId,
      '2026-01-01',
      '2026-02-28',
    );
    expect(statement.revenue.total).toBe(20_000);
    expect(statement.netIncome).toBe(20_000);
  });

  it('keeps the balance sheet balanced through both closes', async () => {
    await post('2026-01-10', 'Venta', [
      { accountId: account['cash'], debit: 20_000 },
      { accountId: account['revenue'], credit: 20_000 },
    ]);
    await closing.closePeriod(januaryId, organizationId, ACTOR);
    await closing.closePeriod(februaryId, organizationId, ACTOR);
    await yearEnd.closeFiscalYear({ fiscalYearId }, organizationId, ACTOR);

    const sheet = await reporting.getBalanceSheet(organizationId, '2026-02-28');
    expect(sheet.isBalanced).toBe(true);
    expect(sheet.assets.total).toBe(20_000);
    expect(sheet.equity.total).toBe(20_000);
    // Everything is in retained earnings now, nothing is left unclosed.
    expect(sheet.equity.unclosedResult).toBe(0);
  });

  it('reopens a closed year’s last period and reverses the annual closing entry', async () => {
    await post('2026-01-10', 'Venta', [
      { accountId: account['cash'], debit: 20_000 },
      { accountId: account['revenue'], credit: 20_000 },
    ]);
    await closing.closePeriod(januaryId, organizationId, ACTOR);
    await closing.closePeriod(februaryId, organizationId, ACTOR);
    await yearEnd.closeFiscalYear({ fiscalYearId }, organizationId, ACTOR);

    await yearEnd.reopenFiscalYear(
      { fiscalYearId, reason: 'Ajuste de auditoría posterior al cierre.' },
      organizationId,
      ACTOR,
    );

    const retained = await balances.balanceOf(account['retained'], {
      organizationId,
      ledgerId,
      asOf: '2026-02-28',
    });
    expect(retained).toBe(0);

    const revenue = await balances.balanceOf(account['revenue'], {
      organizationId,
      ledgerId,
      asOf: '2026-02-28',
    });
    expect(revenue).toBe(-20_000);
  });

  it('refuses to close a period twice', async () => {
    await closing.closePeriod(januaryId, organizationId, ACTOR);
    await expect(closing.closePeriod(januaryId, organizationId, ACTOR)).rejects.toThrow();
  });

  it('refuses to post into the period once it is closed', async () => {
    await closing.closePeriod(januaryId, organizationId, ACTOR);
    await expect(
      post('2026-01-15', 'Tarde', [
        { accountId: account['cash'], debit: 100 },
        { accountId: account['revenue'], credit: 100 },
      ]),
    ).rejects.toThrow();
  });

  it('keeps a draft out of the closed period’s books', async () => {
    const draft = await dataSource.getRepository(JournalEntry).count({
      where: { organizationId, status: JournalEntryStatus.DRAFT },
    });
    expect(draft).toBe(0);
  });
});
