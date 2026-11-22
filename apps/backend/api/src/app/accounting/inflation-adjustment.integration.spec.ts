import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Ledger } from './entities/ledger.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { AccountCategory, AccountNature, AccountRole, AccountType } from '../chart-of-accounts/enums/account-enums';
import { AccountingPeriod, PeriodStatus } from './entities/accounting-period.entity';
import { FiscalYear, FiscalYearStatus } from './entities/fiscal-year.entity';
import { Dimension } from '../dimensions/entities/dimension.entity';
import { DimensionValue } from '../dimensions/entities/dimension-value.entity';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { testExchangeRateResolver } from '../currencies/exchange-rate-resolver.testing';
import { PriceIndicesService } from '../currencies/price-indices.service';
import { ChartOfAccountsService } from '../chart-of-accounts/chart-of-accounts.service';
import { defaultFxTreatment } from '../contracts/accounting/fx-treatment.contract';
import { defaultInflationRestatement } from '@virtex/shared/types';
import { InflationAdjustmentService } from './inflation-adjustment.service';
import { InflationAdjustmentRun, InflationAdjustmentRunStatus } from './entities/inflation-adjustment-run.entity';
import { createTestOrganization, describeWithDb, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * The restatement for inflation (IAS 29; FIN-AC-04), against PostgreSQL, through the real posting
 * service.
 *
 * The fixture is a small Argentine company in a 10 %-a-month economy: capital of 1,000 contributed
 * in January, equipment bought for 600 in January, a sale of 500 in February, a depreciation charge
 * of 60 booked in March for the equipment bought in January. Restated to March (index 133.1), the
 * books must say what the standard says — and the gain or loss on the net monetary position the run
 * books must equal the loss on the money the company held, computed apart: 400 held since January
 * (110 → 133.1) and 500 since February (121 → 133.1) lose 84 + 50 = 134.
 */
describeWithDb('restatement for inflation (FIN-AC-04)', () => {
  jest.setTimeout(120_000);

  let ds: DataSource;
  let entries: JournalEntriesService;
  let indices: PriceIndicesService;
  let service: InflationAdjustmentService;
  let organizationId: string;
  let ledgerId: string;
  let generalJournalId: string;
  const account: Record<string, string> = {};
  const ACTOR = '11111111-1111-4111-8111-111111111111';

  /** 10 % a month from December 2024 = 100. */
  const INDEX: Record<string, string> = {
    '2024-12': '100',
    '2025-01': '110',
    '2025-02': '121',
    '2025-03': '133.1',
    '2025-12': '313.8428376721',
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    // The audit trail is not what is under test: the posting writes to it, nothing here reads it.
    const audit = { recordWithManager: jest.fn().mockResolvedValue(undefined) };
    entries = new JournalEntriesService(
      ds.getRepository(JournalEntry),
      ds.getRepository(JournalEntryAttachment),
      ds,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null), announcePending: jest.fn() } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      audit as never,
      testExchangeRateResolver(ds),
    );
    indices = new PriceIndicesService(ds);
    service = new InflationAdjustmentService(ds, entries, indices, new JournalLookupService(ds.getRepository(Journal)));
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    organizationId = await createTestOrganization(ds, 'QA-AJUSTE');
    await ds.query(`UPDATE organizations SET country = 'AR', timezone = 'America/Argentina/Buenos_Aires' WHERE id = $1`, [organizationId]);
    ledgerId = (
      await ds.getRepository(Ledger).save(
        ds.getRepository(Ledger).create({ organizationId, name: 'Libro principal', currency: 'ARS', isDefault: true, isActive: true }),
      )
    ).id;
    const journals = await ds.getRepository(Journal).save([
      { organizationId, code: 'GENERAL', name: 'Diario general', type: 'GENERAL' as const },
      { organizationId, code: 'AJU-INF', name: 'Diario de ajuste por inflación', type: 'GENERAL' as const },
    ]);
    generalJournalId = journals[0].id;

    const make = async (key: string, code: string, type: AccountType, category: AccountCategory, nature: AccountNature, systemRole: AccountRole | null = null) => {
      const fxTreatment = defaultFxTreatment(type, systemRole);
      const saved = await ds.getRepository(Account).save(
        ds.getRepository(Account).create({
          organizationId,
          code,
          name: { es: key },
          type,
          category,
          nature,
          systemRole,
          isPostable: true,
          isActive: true,
          fxTreatment,
          isInflationAdjustable: defaultInflationRestatement({ type, fxTreatment, isPostable: true, systemRole }),
          effectiveFrom: '2020-01-01' as unknown as Date,
        }),
      );
      account[key] = saved.id;
    };
    await make('cash', '1110', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.CASH);
    await make('equipment', '1210', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.DEBIT);
    await make('accumulated', '1220', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.CREDIT, AccountRole.ACCUMULATED_DEPRECIATION);
    await make('capital', '3100', AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, AccountNature.CREDIT);
    await make('capitalAdjustment', '3110', AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, AccountNature.CREDIT);
    await make('revenue', '4100', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE, AccountNature.CREDIT, AccountRole.SALES_REVENUE);
    await make('depreciation', '5500', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT, AccountRole.DEPRECIATION_EXPENSE);
    await make('recpam', '5760', AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, AccountNature.DEBIT, AccountRole.INFLATION_ADJUSTMENT);
    // Capital stays at nominal value: its restatement goes to «Ajuste de capital».
    await ds.getRepository(Account).update({ id: account['capitalAdjustment'] }, { isInflationAdjustable: false });
    await ds.getRepository(Account).update({ id: account['capital'] }, { inflationAdjustmentAccountId: account['capitalAdjustment'] });

    await ds.query(
      `INSERT INTO organization_settings (organization_id, base_currency, inflation_adjustment_policy, inflation_index_series_code, default_inflation_adjustment_account_id)
       VALUES ($1, 'ARS', 'YEAR_END', 'AR-FACPCE', $2)`,
      [organizationId, account['recpam']],
    );

    const months = Array.from({ length: 12 }, (_, index) => index + 1);
    await ds.getRepository(AccountingPeriod).save(
      months.map((month) => {
        const mm = String(month).padStart(2, '0');
        const end = new Date(Date.UTC(2025, month, 0)).toISOString().slice(0, 10);
        return { organizationId, name: `2025-${mm}`, startDate: `2025-${mm}-01` as unknown as Date, endDate: end as unknown as Date, status: PeriodStatus.OPEN };
      }),
    );
    await ds.getRepository(AccountingPeriod).save([
      { organizationId, name: '2026-01', startDate: '2026-01-01' as unknown as Date, endDate: '2026-01-31' as unknown as Date, status: PeriodStatus.OPEN },
    ]);
    await ds.getRepository(FiscalYear).save([
      { organizationId, startDate: '2025-01-01' as unknown as Date, endDate: '2025-12-31' as unknown as Date, status: FiscalYearStatus.OPEN },
      { organizationId, startDate: '2026-01-01' as unknown as Date, endDate: '2026-12-31' as unknown as Date, status: FiscalYearStatus.OPEN },
    ]);

    await indices.recordForCompany(
      organizationId,
      'AR-FACPCE',
      Object.entries(INDEX).map(([period, value]) => ({ period, value })),
      null,
    );

    await post('2025-01-10', [
      { accountId: account['cash'], debit: 1000 },
      { accountId: account['capital'], credit: 1000 },
    ]);
    await post('2025-01-20', [
      { accountId: account['equipment'], debit: 600 },
      { accountId: account['cash'], credit: 600 },
    ]);
    await post('2025-02-15', [
      { accountId: account['cash'], debit: 500 },
      { accountId: account['revenue'], credit: 500 },
    ]);
    // Depreciation of the January equipment, booked in March: it originates in January.
    await post('2025-03-31', [
      { accountId: account['depreciation'], debit: 60, originDate: '2025-01-20' },
      { accountId: account['accumulated'], credit: 60, originDate: '2025-01-20' },
    ]);
  });

  afterEach(async () => {
    await ds.query(`DELETE FROM organizations WHERE id = $1`, [organizationId]);
  });

  function post(
    date: string,
    lines: Array<{ accountId: string; debit?: number; credit?: number; originDate?: string; dimensions?: Record<string, string> }>,
  ): Promise<JournalEntry> {
    return entries.create(
      {
        date,
        description: 'QA',
        journalId: generalJournalId,
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit ?? 0,
          credit: line.credit ?? 0,
          ...(line.originDate ? { originDate: line.originDate } : {}),
          ...(line.dimensions ? { dimensions: line.dimensions } : {}),
        })),
      } as CreateJournalEntryDto,
      organizationId,
      { actorUserId: ACTOR },
    );
  }

  /** The ledger balance of an account at a date, debit-positive, as a number. */
  async function balance(key: string, asOf = '2025-12-31'): Promise<number> {
    const [row] = await ds.query(
      `SELECT COALESCE(SUM(v.debit - v.credit), 0)::float8 AS balance
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
         JOIN journal_entry_line_valuations v ON v.journal_entry_line_id = l.id AND v.ledger_id = $3
        WHERE e.organization_id = $1 AND l.account_id = $2 AND e.status IN ('Posted', 'Modified') AND e.date <= $4`,
      [organizationId, account[key], ledgerId, asOf],
    );
    return Number(row.balance);
  }

  const adjustmentOf = (plan: { lines: Array<{ accountId: string; adjustment: string }> }, key: string) =>
    plan.lines.filter((line) => line.accountId === account[key]).reduce((sum, line) => sum + Number(line.adjustment), 0);

  it('restates each amount from the month it originated, and nets to the loss on the money held', async () => {
    const plan = await service.plan(ds.manager, organizationId, '2025-03');
    expect(plan.blockers).toEqual([]);
    expect(adjustmentOf(plan, 'equipment')).toBe(126); // 600 × 133.1 / 110 = 726
    expect(adjustmentOf(plan, 'accumulated')).toBe(-12.6); // −60 from January: −72.60
    expect(adjustmentOf(plan, 'capital')).toBe(-210); // −1,000 from January: −1,210
    expect(adjustmentOf(plan, 'revenue')).toBe(-50); // −500 from February: −550
    expect(adjustmentOf(plan, 'depreciation')).toBe(12.6); // the charge, from the acquisition
    expect(plan.lines.find((line) => line.accountId === account['cash'])).toBeUndefined();
    // Loss on the net monetary position: 400 × (133.1/110 − 1) + 500 × (133.1/121 − 1) = 84 + 50.
    expect(plan.netMonetaryResult).toBe('134.00');
    expect(Object.keys(plan.indexValues).sort()).toEqual(['2025-01', '2025-02', '2025-03']);
  });

  it('posts it once, capital kept at nominal value, and a second run finds the first', async () => {
    const first = await service.run(organizationId, '2025-03', ACTOR);
    expect(first.created).toBe(true);
    expect(first.run.journalEntryId).toBeTruthy();
    expect(await balance('equipment', '2025-03-31')).toBe(726);
    expect(await balance('capital', '2025-03-31')).toBe(-1000);
    expect(await balance('capitalAdjustment', '2025-03-31')).toBe(-210);
    expect(await balance('revenue', '2025-03-31')).toBe(-550);
    expect(await balance('recpam', '2025-03-31')).toBe(134);
    const [entry] = await ds.query(`SELECT system_reason, idempotency_key FROM journal_entries WHERE id = $1`, [first.run.journalEntryId]);
    expect(entry).toEqual({ system_reason: 'inflation-adjustment', idempotency_key: `inflation-adjustment:${first.run.id}` });

    const again = await service.run(organizationId, '2025-03', ACTOR);
    expect(again).toMatchObject({ created: false, run: { id: first.run.id } });
    const outlook = await service.outlook(organizationId, '2025-03');
    expect(outlook).toMatchObject({ current: true, lines: [], run: { id: first.run.id } });
    expect(outlook.replacement?.netMonetaryResult).toBe('134.00');
  });

  it('refuses an earlier month while a later one is restated, and allows it once that one is undone', async () => {
    const march = await service.run(organizationId, '2025-03', ACTOR);
    await expect(service.run(organizationId, '2025-02', ACTOR)).rejects.toMatchObject({
      messageKey: 'inflation_adjustment.later_period_restated',
      status: 409,
    });
    await service.reverse(organizationId, march.run.id, ACTOR, 'QA');
    expect(await balance('equipment', '2025-03-31')).toBe(600);

    // February: 600 × 121 / 110 = 660; capital −1,100; the sale is already in February's unit.
    const february = await service.run(organizationId, '2025-02', ACTOR);
    expect(february.created).toBe(true);
    expect(await balance('equipment', '2025-02-28')).toBe(660);
    expect(await balance('recpam', '2025-02-28')).toBe(40); // 400 × (121/110 − 1)
    // March on top of February: the whole restated figure, the difference posted.
    await service.run(organizationId, '2025-03', ACTOR);
    expect(await balance('equipment', '2025-03-31')).toBe(726);
    expect(await balance('recpam', '2025-03-31')).toBe(134);
  });

  it('says a run no longer holds when its index is revised, and replaces it', async () => {
    const first = await service.run(organizationId, '2025-03', ACTOR);
    await indices.recordForCompany(organizationId, 'AR-FACPCE', [{ period: '2025-03', value: '140' }], null);
    const outlook = await service.outlook(organizationId, '2025-03');
    expect(outlook.current).toBe(false);

    const replaced = await service.run(organizationId, '2025-03', ACTOR, { replace: true });
    expect(replaced.created).toBe(true);
    expect(await balance('equipment', '2025-03-31')).toBe(763.64); // 600 × 140 / 110
    const runs = await ds.getRepository(InflationAdjustmentRun).find({ where: { organizationId }, order: { ranAt: 'ASC' } });
    expect(runs.map((run) => run.status)).toEqual([InflationAdjustmentRunStatus.REVERSED, InflationAdjustmentRunStatus.POSTED]);
    expect(runs[0].reversalEntryId).toBeTruthy();
    expect(replaced.run.indexValues['2025-03']).toMatchObject({ value: '140', revision: 2, source: 'COMPANY' });
    expect(first.run.id).toBe(runs[0].id);
  });

  it('refuses a month whose index, or the index of a month an amount comes from, is missing', async () => {
    await expect(service.run(organizationId, '2025-04', ACTOR)).rejects.toMatchObject({
      messageKey: 'inflation_adjustment.closing_index_missing',
      params: { series: 'AR-FACPCE', period: '2025-04' },
    });
    // An amount that originated in November 2024, a month with no index.
    await post('2025-03-10', [
      { accountId: account['equipment'], debit: 100, originDate: '2024-11-15' },
      { accountId: account['cash'], credit: 100 },
    ]);
    await expect(service.run(organizationId, '2025-03', ACTOR)).rejects.toMatchObject({
      messageKey: 'inflation_adjustment.index_missing',
      params: { months: '2024-11' },
    });
  });

  it('restates income and expenses within their fiscal year only', async () => {
    await post('2026-01-15', [
      { accountId: account['cash'], debit: 100 },
      { accountId: account['revenue'], credit: 100 },
    ]);
    await indices.recordForCompany(organizationId, 'AR-FACPCE', [{ period: '2026-01', value: '345.2271214393' }], null);
    const plan = await service.plan(ds.manager, organizationId, '2026-01');
    const revenue = plan.accounts.filter((line) => line.accountId === account['revenue']);
    // Only the January 2026 sale, in January's own unit: nothing to restate. 2025's 500 is not there.
    expect(revenue).toHaveLength(1);
    expect(revenue[0]).toMatchObject({ historical: '-100.00', restated: '-100.00', adjustment: '0.00' });
  });

  it('keeps each cost centre apart, the counterpart by combination too', async () => {
    const dimension = await ds.getRepository(Dimension).save(ds.getRepository(Dimension).create({ organizationId, name: 'Centro', isActive: true }));
    for (const value of ['A', 'B']) {
      await ds.getRepository(DimensionValue).save(ds.getRepository(DimensionValue).create({ dimensionId: dimension.id, value, isActive: true }));
    }
    await post('2025-02-20', [
      { accountId: account['cash'], debit: 300 },
      { accountId: account['revenue'], credit: 200, dimensions: { Centro: 'A' } },
      { accountId: account['revenue'], credit: 100, dimensions: { Centro: 'B' } },
    ]);
    const { run } = await service.run(organizationId, '2025-03', ACTOR);
    const lines: Array<{ account_id: string; dimensions: Record<string, string> | null; debit: string; credit: string }> = await ds.query(
      `SELECT account_id, dimensions, debit::text, credit::text FROM journal_entry_lines WHERE journal_entry_id = $1`,
      [run.journalEntryId],
    );
    const revenueA = lines.find((line) => line.account_id === account['revenue'] && line.dimensions?.['Centro'] === 'A');
    const recpamA = lines.find((line) => line.account_id === account['recpam'] && line.dimensions?.['Centro'] === 'A');
    expect(revenueA).toMatchObject({ credit: '20.00' }); // −200 × 133.1/121 = −220
    expect(recpamA).toMatchObject({ debit: '20.00' });
    expect(lines.some((line) => line.account_id === account['recpam'] && !line.dimensions)).toBe(true);
  });

  it('restates nothing in books kept in another currency than the index measures', async () => {
    await ds.getRepository(Ledger).update({ id: ledgerId }, { currency: 'USD' });
    const plan = await service.plan(ds.manager, organizationId, '2025-03');
    expect(plan.blockers).toContainEqual({
      key: 'inflation_adjustment.series_currency_differs',
      params: { series: 'AR-FACPCE', currency: 'ARS', ledgerCurrency: 'USD' },
    });
    await expect(service.run(organizationId, '2025-03', ACTOR)).rejects.toMatchObject({ messageKey: 'inflation_adjustment.series_currency_differs' });
  });

  it('refuses a closed period', async () => {
    await ds.getRepository(AccountingPeriod).update({ organizationId, name: '2025-03' }, { status: PeriodStatus.CLOSED, generalLedgerStatus: PeriodStatus.CLOSED });
    await expect(service.run(organizationId, '2025-03', ACTOR)).rejects.toMatchObject({ status: 409 });
  });

  it('is run by the close of the year’s last period under YEAR_END, once', async () => {
    const close = () => ds.transaction((manager) => service.runForClose(organizationId, { startDate: '2025-12-01', endDate: '2025-12-31' }, manager));
    expect(await ds.transaction((manager) => service.runForClose(organizationId, { startDate: '2025-03-01', endDate: '2025-03-31' }, manager))).toMatchObject({
      due: false,
    });
    expect(await close()).toMatchObject({ due: true, performed: true });
    expect(await close()).toMatchObject({ due: true, performed: false });
    // 600 × 313.84… / 110
    expect(await balance('equipment')).toBe(1711.87);
    await ds.query(`UPDATE organization_settings SET inflation_adjustment_policy = 'NONE' WHERE organization_id = $1`, [organizationId]);
    expect(await close()).toMatchObject({ due: false, performed: false });
  });

  it('carries the origin of each line into its reversal, and refuses an origin after the entry', async () => {
    const [depreciation] = await ds.query(
      `SELECT e.id FROM journal_entries e JOIN journal_entry_lines l ON l.journal_entry_id = e.id
        WHERE e.organization_id = $1 AND l.account_id = $2`,
      [organizationId, account['depreciation']],
    );
    const reversal = await entries.reverse(depreciation.id, organizationId, { reversalDate: '2025-03-31', reason: 'QA' } as never, { actorUserId: ACTOR });
    const origins: Array<{ origin_date: string }> = await ds.query(
      `SELECT to_char(origin_date, 'YYYY-MM-DD') AS origin_date FROM journal_entry_lines WHERE journal_entry_id = $1`,
      [reversal.id],
    );
    expect(origins.map((row) => row.origin_date)).toEqual(['2025-01-20', '2025-01-20']);
    await expect(
      post('2025-03-10', [
        { accountId: account['equipment'], debit: 1, originDate: '2025-04-01' },
        { accountId: account['cash'], credit: 1 },
      ]),
    ).rejects.toMatchObject({ messageKey: 'journal_entries.origin_date_after_entry', status: 422 });
  });

  it('restates only non-monetary accounts, with a restatement account of their own', async () => {
    await expect(
      ds.query(`UPDATE accounts SET is_inflation_adjustable = true WHERE id = $1`, [account['cash']]),
    ).rejects.toThrow(/CHK_accounts_inflation_restatement_non_monetary/);
    const facts = (key: string, code: string, type: string, fxTreatment: 'REVALUED' | 'HISTORICAL') => ({
      id: account[key],
      code,
      type,
      fxTreatment,
      isPostable: true,
      systemRole: null,
    });
    await expect(
      ChartOfAccountsService.resolveRestatementSettings(ds.manager, organizationId, facts('cash', '1110', 'ASSET', 'REVALUED'), { isInflationAdjustable: true }, null),
    ).rejects.toMatchObject({ messageKey: 'chart_of_accounts.restatement_only_non_monetary' });
    // «Ajuste de capital» already takes capital's restatement: not equipment's too.
    await expect(
      ChartOfAccountsService.resolveRestatementSettings(
        ds.manager,
        organizationId,
        facts('equipment', '1210', 'ASSET', 'HISTORICAL'),
        { inflationAdjustmentAccountId: account['capitalAdjustment'] },
        { isInflationAdjustable: true, inflationAdjustmentAccountId: null },
      ),
    ).rejects.toMatchObject({ messageKey: 'chart_of_accounts.restatement_account_unfit' });
    // And it is never restated by itself.
    await expect(
      ChartOfAccountsService.resolveRestatementSettings(
        ds.manager,
        organizationId,
        facts('capitalAdjustment', '3110', 'EQUITY', 'HISTORICAL'),
        { isInflationAdjustable: true },
        { isInflationAdjustable: false, inflationAdjustmentAccountId: null },
      ),
    ).rejects.toMatchObject({ messageKey: 'chart_of_accounts.restatement_target_cannot_be_restated' });
  });

  it('versions the index: a correction is a new revision, the same figure records nothing', async () => {
    expect(await indices.recordForCompany(organizationId, 'AR-FACPCE', [{ period: '2025-01', value: '110.0000' }], null)).toEqual({
      recorded: 0,
      unchanged: 1,
    });
    expect(await indices.recordForCompany(organizationId, 'AR-FACPCE', [{ period: '2025-01', value: '110.5' }], null)).toEqual({
      recorded: 1,
      unchanged: 0,
    });
    const history = await indices.history(organizationId, 'AR-FACPCE', '2025-01');
    expect(history.map((entry) => [entry.value, entry.revision])).toEqual([
      ['110.5', 2],
      ['110', 1],
    ]);
    await expect(indices.recordForCompany(organizationId, 'AR-FACPCE', [{ period: '2999-01', value: '1' }], null)).rejects.toMatchObject({
      messageKey: 'price_indices.period_in_future',
    });
    await expect(indices.recordForCompany(organizationId, 'XX-NONE', [{ period: '2025-01', value: '1' }], null)).rejects.toMatchObject({
      messageKey: 'price_indices.series_unknown',
    });
  });

  it('uses the published figure over the company’s own where both exist', async () => {
    // A month nobody else restates: the platform's figure for it is this test's alone.
    const month = '1990-01';
    try {
      await indices.recordForCompany(organizationId, 'AR-FACPCE', [{ period: month, value: '2' }], null);
      expect((await indices.resolve(organizationId, 'AR-FACPCE', month, month)).get(month)).toMatchObject({ value: '2', source: 'COMPANY' });
      await indices.recordPublished('AR-FACPCE', [{ period: month, value: '3' }], null);
      expect((await indices.resolve(organizationId, 'AR-FACPCE', month, month)).get(month)).toMatchObject({
        value: '3',
        source: 'PLATFORM',
        companyValue: { value: '2', revision: 1 },
      });
    } finally {
      await ds.query(`DELETE FROM price_index_values WHERE series_code = 'AR-FACPCE' AND period = '1990-01-01'`);
    }
  });
});
