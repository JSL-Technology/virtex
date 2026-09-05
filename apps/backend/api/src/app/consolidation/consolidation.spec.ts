import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { OrganizationSubsidiary } from '../organizations/entities/organization-subsidiary.entity';
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
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { FinancialReportingService } from '../financial-reporting/financial-reporting.service';
import { ExchangeRate, ExchangeRateType } from '../currencies/entities/exchange-rate.entity';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { ConsolidationMap } from './entities/consolidation-map.entity';
import { IntercompanyTransaction } from '../intercompany/entities/intercompany-transaction.entity';
import { ConsolidationService } from './consolidation.service';
import { roundAmount } from '../common/money';

/**
 * Consolidated statements: NIIF 10 and NIC 21.
 *
 * The group is a USD parent owning 80 % of a CLP subsidiary — the shape this product actually
 * sells into, and the shape every one of the previous implementation's four defects shows up in.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('group consolidation', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let entries: JournalEntriesService;
  let consolidation: ConsolidationService;

  let parentId: string;
  let subsidiaryId: string;
  const parentAccount: Record<string, string> = {};
  const subAccount: Record<string, string> = {};
  const parentJournal = { id: '' };
  const subJournal = { id: '' };

  const ACTOR = '55555555-5555-4555-8555-555555555555';
  const ctx = { actorUserId: ACTOR };

  const CLOSING_RATE = 60; // CLP → USD is 1/60 at the reporting date.
  const OPENING_RATE = 50;

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
    const reporting = new FinancialReportingService(dataSource, balances);
    const resolver = new ExchangeRateResolver(dataSource);

    entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null) } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      audit,
    );

    consolidation = new ConsolidationService(
      dataSource.getRepository(Organization),
      dataSource.getRepository(ConsolidationMap),
      dataSource.getRepository(OrganizationSettings),
      dataSource.getRepository(IntercompanyTransaction),
      resolver,
      reporting,
      dataSource,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  /** One tenant with a ledger, a journal, a chart and an open year. */
  async function makeOrganization(
    name: string,
    currency: string,
    accounts: Record<string, string>,
    journalRef: { id: string },
  ): Promise<string> {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );

    await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({
        organizationId: org.id,
        name: 'Libro principal',
        currency,
        isDefault: true,
        isActive: true,
      }),
    );

    const journal = await dataSource.getRepository(Journal).save({
      organizationId: org.id,
      code: 'GENERAL',
      name: 'Diario general',
      type: 'GENERAL' as const,
    });
    journalRef.id = journal.id;

    const make = async (
      key: string,
      code: string,
      label: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
    ) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId: org.id,
          code,
          name: { es: label },
          type,
          category,
          nature,
          isPostable: true,
          isActive: true,
        }),
      );
      accounts[key] = saved.id;
    };

    await make('cash', '1101', 'Efectivo', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('receivable', '1201', 'Cuentas por cobrar', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('investment', '1601', 'Inversión en subsidiaria', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.DEBIT);
    await make('payable', '2101', 'Cuentas por pagar', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, AccountNature.CREDIT);
    await make('capital', '3101', 'Capital social', AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, AccountNature.CREDIT);
    await make('revenue', '4101', 'Ingresos', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.CREDIT);
    await make('expense', '5101', 'Gastos', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId: org.id,
        baseCurrency: currency,
        exchangeRateType: ExchangeRateType.OFFICIAL,
      }),
    );

    await dataSource.getRepository(AccountingPeriod).save([
      {
        organizationId: org.id,
        name: 'Ejercicio 2026',
        startDate: '2026-01-01' as unknown as Date,
        endDate: '2026-12-31' as unknown as Date,
        status: PeriodStatus.OPEN,
      },
    ]);

    return org.id;
  }

  const post = (
    organizationId: string,
    journalId: string,
    date: string,
    description: string,
    lines: { accountId: string; debit?: number; credit?: number }[],
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
        })),
      } as CreateJournalEntryDto,
      organizationId,
      ctx,
    );

  beforeEach(async () => {
    // Only this suite's pair. `exchange_rates` is global by design — a rate is a fact about the
    // market, not about a tenant — so clearing it would delete the rates the payables, receipts and
    // treasury suites publish while they run beside this one.
    await dataSource
      .getRepository(ExchangeRate)
      .createQueryBuilder()
      .delete()
      .where('"fromCurrency" = :from AND "toCurrency" = :to', { from: 'USD', to: 'CLP' })
      .execute();
    // CLP → USD across the year. The subsidiary keeps its books in CLP; the group presents in USD.
    await dataSource.getRepository(ExchangeRate).save([
      { fromCurrency: 'USD', toCurrency: 'CLP', rate: OPENING_RATE, date: '2026-01-31' as unknown as Date, rateType: ExchangeRateType.OFFICIAL, source: 'TEST', recordedByUserId: null },
      { fromCurrency: 'USD', toCurrency: 'CLP', rate: CLOSING_RATE, date: '2026-12-31' as unknown as Date, rateType: ExchangeRateType.OFFICIAL, source: 'TEST', recordedByUserId: null },
    ]);

    parentId = await makeOrganization('Matriz', 'USD', parentAccount, parentJournal);
    subsidiaryId = await makeOrganization('Subsidiaria', 'CLP', subAccount, subJournal);

    await dataSource.getRepository(OrganizationSubsidiary).save({
      parentOrganizationId: parentId,
      subsidiaryOrganizationId: subsidiaryId,
      ownership: 80,
      acquisitionDate: '2026-01-31',
      acquisitionCost: null,
      investmentAccountId: parentAccount['investment'],
    });
  });

  afterEach(async () => {
    const repo = dataSource.getRepository(Organization);
    if (subsidiaryId) await repo.delete({ id: subsidiaryId });
    if (parentId) await repo.delete({ id: parentId });
  });

  /** Both companies capitalised and trading. */
  async function tradeBothCompanies(): Promise<void> {
    // Parent: 10,000 USD of capital in cash, then a 4,000 sale on credit against 1,000 of costs.
    await post(parentId, parentJournal.id, '2026-01-05', 'Capital', [
      { accountId: parentAccount['cash'], debit: 10_000 },
      { accountId: parentAccount['capital'], credit: 10_000 },
    ]);
    await post(parentId, parentJournal.id, '2026-06-15', 'Venta', [
      { accountId: parentAccount['receivable'], debit: 4_000 },
      { accountId: parentAccount['revenue'], credit: 4_000 },
    ]);
    await post(parentId, parentJournal.id, '2026-06-20', 'Gasto', [
      { accountId: parentAccount['expense'], debit: 1_000 },
      { accountId: parentAccount['cash'], credit: 1_000 },
    ]);

    // Subsidiary: 600,000 CLP of capital, a 300,000 sale and 120,000 of costs.
    await post(subsidiaryId, subJournal.id, '2026-01-05', 'Capital', [
      { accountId: subAccount['cash'], debit: 600_000 },
      { accountId: subAccount['capital'], credit: 600_000 },
    ]);
    await post(subsidiaryId, subJournal.id, '2026-06-15', 'Venta', [
      { accountId: subAccount['receivable'], debit: 300_000 },
      { accountId: subAccount['revenue'], credit: 300_000 },
    ]);
    await post(subsidiaryId, subJournal.id, '2026-06-20', 'Gasto', [
      { accountId: subAccount['expense'], debit: 120_000 },
      { accountId: subAccount['cash'], credit: 120_000 },
    ]);
  }

  const run = () => consolidation.runConsolidation(parentId, '2026-12-31', '2026-01-01');

  // ───────────────────────────────────────────────────────────────────────────

  it('produces a consolidated balance sheet that balances', async () => {
    await tradeBothCompanies();
    const result = await run();

    expect(result.balanceSheet.isBalanced).toBe(true);
    expect(result.balanceSheet.outOfBalanceBy).toBe(0);
    expect(result.presentationCurrency).toBe('USD');
  });

  /**
   * NIC 21.39: assets at the closing rate, income and expenses at the average.
   *
   * Everything used to be multiplied by the closing rate, which is not a translation — it is one
   * rate applied to three things the standard translates differently.
   */
  it('translates assets at the closing rate and results at the average rate', async () => {
    await tradeBothCompanies();
    const result = await run();

    const subsidiary = result.entities.find((e) => e.role === 'SUBSIDIARY');
    expect(subsidiary).toBeDefined();
    expect(subsidiary!.functionalCurrency).toBe('CLP');

    // CLP → USD: the table stores USD → CLP, so the resolver inverts it.
    expect(subsidiary!.rates.closing).toBeCloseTo(1 / CLOSING_RATE, 8);
    expect(subsidiary!.rates.average).not.toBeCloseTo(subsidiary!.rates.closing, 8);
    expect(subsidiary!.rates.averagedOver.length).toBeGreaterThan(1);

    // Net assets in CLP: 600,000 capital + 180,000 result = 780,000.
    expect(subsidiary!.functional.equity).toBeCloseTo(780_000, 2);
    expect(subsidiary!.presented.equity).toBeCloseTo(780_000 / CLOSING_RATE, 2);
    expect(subsidiary!.presented.netIncome).toBeCloseTo(
      roundAmount(180_000 * subsidiary!.rates.average),
      0,
    );
  });

  /**
   * NIC 21.41: the difference goes to other comprehensive income.
   *
   * Translating at three different rates cannot balance without it. There was no such component,
   * so the difference was simply absorbed into whatever the figures happened to add up to.
   */
  it('recognises the exchange difference as a separate component of equity', async () => {
    await tradeBothCompanies();
    const result = await run();

    expect(result.balanceSheet.accumulatedTranslationAdjustment).not.toBe(0);

    const subsidiary = result.entities.find((e) => e.role === 'SUBSIDIARY')!;
    const equityAccounts = subsidiary.presented.equity - subsidiary.translationAdjustment;
    expect(roundAmount(equityAccounts - subsidiary.presented.netIncome)).toBeCloseTo(
      roundAmount(600_000 * subsidiary.rates.historical),
      0,
    );
  });

  /**
   * NIIF 10.22: the 20 % of the subsidiary the group does not own.
   *
   * `ownership` was read exactly once — into a log line. A group owning 80 % reported 100 % of the
   * subsidiary's equity and 100 % of its profit as its own.
   */
  it('presents the non-controlling interest in equity and in profit', async () => {
    await tradeBothCompanies();
    const result = await run();

    const subsidiary = result.entities.find((e) => e.role === 'SUBSIDIARY')!;

    expect(result.balanceSheet.nonControllingInterests).toBeCloseTo(
      roundAmount(subsidiary.presented.equity * 0.2),
      2,
    );
    expect(result.incomeStatement.attributableToNonControlling).toBeCloseTo(
      roundAmount(subsidiary.presented.netIncome * 0.2),
      2,
    );

    // The two halves of equity add back to the whole.
    expect(
      roundAmount(
        result.balanceSheet.equityAttributableToParent +
          result.balanceSheet.nonControllingInterests,
      ),
    ).toBeCloseTo(result.balanceSheet.totalEquity, 2);

    expect(
      roundAmount(
        result.incomeStatement.attributableToParent +
          result.incomeStatement.attributableToNonControlling,
      ),
    ).toBeCloseTo(result.incomeStatement.netIncome, 2);
  });

  /** A consolidated income statement at all — there was none, only a statement of position. */
  it('produces a consolidated income statement over the stated period', async () => {
    await tradeBothCompanies();
    const result = await run();

    expect(result.period).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(result.incomeStatement.totalRevenue).toBeGreaterThan(0);
    expect(result.incomeStatement.totalExpenses).toBeGreaterThan(0);
    expect(result.incomeStatement.netIncome).toBeCloseTo(
      roundAmount(result.incomeStatement.totalRevenue - result.incomeStatement.totalExpenses),
      2,
    );
  });

  /** A group figure has to be traceable back to the company that produced it. */
  it('records which company contributed each consolidated line', async () => {
    await tradeBothCompanies();
    const result = await run();

    const cash = result.balanceSheet.assets.find((line) => line.code === '1101');
    expect(cash).toBeDefined();
    expect(cash!.contributions).toHaveLength(2);
    expect(cash!.contributions.map((c) => c.organizationId).sort()).toEqual(
      [parentId, subsidiaryId].sort(),
    );
  });

  /**
   * An unmapped subsidiary account used to be dropped with a warning, which silently removes an
   * asset from a balance sheet. It is now presented under its own code and reported.
   */
  it('presents an unmapped subsidiary account rather than dropping it', async () => {
    await tradeBothCompanies();

    await dataSource.getRepository(ConsolidationMap).save({
      parentOrganizationId: parentId,
      subsidiaryOrganizationId: subsidiaryId,
      subsidiaryAccountId: subAccount['cash'],
      parentAccountId: parentAccount['cash'],
    });

    const result = await run();

    expect(result.balanceSheet.isBalanced).toBe(true);
    // The subsidiary's receivable has no mapping, so it is reported and still consolidated.
    expect(result.warnings.some((w) => w.code === 'UNMAPPED_ACCOUNT')).toBe(true);
    expect(result.balanceSheet.assets.some((line) => line.code === '1201')).toBe(true);
  });

  it('reports the absence of an acquisition date instead of silently using the closing rate', async () => {
    await tradeBothCompanies();
    await dataSource
      .getRepository(OrganizationSubsidiary)
      .update({ parentOrganizationId: parentId, subsidiaryOrganizationId: subsidiaryId }, {
        acquisitionDate: null,
      });

    const result = await run();
    expect(result.warnings.some((w) => w.code === 'NO_ACQUISITION_DATE')).toBe(true);
  });

  it('refuses a period that runs backwards', async () => {
    await expect(
      consolidation.runConsolidation(parentId, '2026-01-01', '2026-12-31'),
    ).rejects.toThrow();
  });

  it('refuses to consolidate an organization with no subsidiaries', async () => {
    await expect(
      consolidation.runConsolidation(subsidiaryId, '2026-12-31', '2026-01-01'),
    ).rejects.toThrow();
  });
});
