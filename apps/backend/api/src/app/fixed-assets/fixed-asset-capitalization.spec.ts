import { DataSource, EntityManager } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FixedAssetsService } from './fixed-assets.service';
import { FixedAssetCapitalizationService } from './capitalization.service';
import { FixedAssetClosingBlockersProvider } from './fixed-asset-closing-blockers.provider';
import { TaxBookService } from './tax-book.service';
import { DepreciationService } from './depreciation.service';
import { DepreciationRunTrigger } from './entities/fixed-asset-depreciation-run.entity';
import { AssetPostingService } from './asset-posting.service';
import { DepreciationMethod, FixedAsset, FixedAssetCapitalization, FixedAssetStatus } from './entities/fixed-asset.entity';
import { CreateFixedAssetDto } from './dto/fixed-asset.dto';
import { describeEntryOrigin } from '../journal-entries/entry-origin';
import { I18nService } from '../i18n/i18n.service';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { Journal } from '../journal-entries/entities/journal.entity';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { Ledger } from '../accounting/entities/ledger.entity';
import { AccountingPeriod, PeriodStatus } from '../accounting/entities/accounting-period.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { AccountCategory, AccountNature, AccountType } from '../chart-of-accounts/enums/account-enums';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { testExchangeRateResolver } from '../currencies/exchange-rate-resolver.testing';
import { resolvePaging } from '../common/pagination';
import { createTestOrganization, describeWithDb, openTestDataSource } from '../common/database/testing/integration-db';
import { SYSTEM_JOURNALS } from '../contracts/ledger-posting/system-journals';

/**
 * How an asset's cost entered the ledger, and the register against the ledger (audit 2026-11-07,
 * FINB-15), on a real database and the real ledger: registering posts the acquisition or names the
 * bill or entry that did — never more than it debited —, an edit posts it again, a deletion
 * reverses it, the source cannot be reversed from under its assets, and the reconciliation puts
 * each account's register against its balance and explains the difference to the cent.
 */
describeWithDb('fixed-asset capitalization and the register against the ledger', () => {
  jest.setTimeout(240_000);

  let dataSource: DataSource;
  let entries: JournalEntriesService;
  let posting: AssetPostingService;
  let assets: FixedAssetsService;
  let capitalization: FixedAssetCapitalizationService;
  let balances: AccountBalancesService;
  let depreciation: DepreciationService;
  let make: (key: string, code: string, type: AccountType, category: AccountCategory, nature: AccountNature) => Promise<void>;
  let organizationId: string;
  let ledgerId: string;
  let generalJournalId: string;
  const account: Record<string, string> = {};
  const ACTOR = '11111111-1111-4111-8111-111111111111';

  /** The company's settings, read by their columns — without the organizations module's entity. */
  const settingsReader = {
    getForOrg: async (id: string, manager?: EntityManager) => {
      const [row] = await (manager ?? dataSource.manager).query(
        `SELECT "default_depreciation_expense_account_id" AS "defaultDepreciationExpenseAccountId",
                "default_accumulated_depreciation_account_id" AS "defaultAccumulatedDepreciationAccountId",
                "default_depreciation_convention" AS "defaultDepreciationConvention"
           FROM "organization_settings" WHERE "organization_id" = $1`,
        [id],
      );
      return row ?? null;
    },
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'capitalization');
    await dataSource.query(`UPDATE organizations SET country = 'DO', books_language = 'es' WHERE id = $1`, [organizationId]);
    entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null), announcePending: jest.fn() } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      { recordWithManager: jest.fn().mockResolvedValue(undefined) } as never,
      testExchangeRateResolver(dataSource),
    );
    posting = new AssetPostingService(entries);
    const lookup = new JournalLookupService(dataSource.getRepository(Journal));
    const i18n = new I18nService();
    const taxBooks = new TaxBookService(dataSource, i18n);
    depreciation = new DepreciationService(posting, new SchedulerLockService(dataSource), dataSource, settingsReader as never, lookup, taxBooks);
    capitalization = new FixedAssetCapitalizationService(dataSource, posting, lookup, new LedgerNarrativeService(i18n));
    assets = new FixedAssetsService(dataSource.getRepository(FixedAsset), dataSource, posting, lookup, depreciation, taxBooks, i18n, capitalization);
    balances = new AccountBalancesService(dataSource);

    const ledger = await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({ organizationId, name: 'Libro principal', currency: 'DOP', isDefault: true, isActive: true }),
    );
    ledgerId = ledger.id;
    const journals = await dataSource.getRepository(Journal).save(
      Object.values(SYSTEM_JOURNALS).map((journal) => ({ organizationId, code: journal.code, name: journal.code, type: journal.type })),
    );
    generalJournalId = journals.find((journal) => journal.code === SYSTEM_JOURNALS.general.code)?.id as string;
    const periods = [];
    for (let index = 0; index < 24; index++) {
      const start = new Date(Date.UTC(2025, 6 + index, 1));
      const end = new Date(Date.UTC(2025, 7 + index, 0));
      periods.push({
        organizationId,
        name: start.toISOString().slice(0, 7),
        startDate: start.toISOString().slice(0, 10) as unknown as Date,
        endDate: end.toISOString().slice(0, 10) as unknown as Date,
        status: PeriodStatus.OPEN,
      });
    }
    await dataSource.getRepository(AccountingPeriod).save(periods);
    make = async (key: string, code: string, type: AccountType, category: AccountCategory, nature: AccountNature) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({ organizationId, code, name: { es: key }, type, category, nature, isPostable: true, isActive: true }),
      );
      account[key] = saved.id;
    };
    await make('bank', '1102', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('equipment', '1504', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.DEBIT);
    await make('accumulated', '1591', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.CREDIT);
    await make('payable', '2101', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY, AccountNature.CREDIT);
    await make('equity', '3101', AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, AccountNature.CREDIT);
    await make('depreciation', '5201', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await dataSource.query(
      `INSERT INTO "organization_settings" ("organization_id", "base_currency", "default_depreciation_expense_account_id", "default_accumulated_depreciation_account_id")
       VALUES ($1, 'DOP', $2, $3)`,
      [organizationId, account['depreciation'], account['accumulated']],
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [organizationId]);
    await dataSource.destroy();
  });

  const register = (dto: Partial<CreateFixedAssetDto> & Pick<CreateFixedAssetDto, 'name' | 'cost'>) =>
    assets.create(
      {
        acquisitionDate: '2026-02-01',
        usefulLifeMonths: 60,
        depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
        depreciationConvention: 'FULL_MONTH',
        assetAccountId: account['equipment'],
        accumulatedDepreciationAccountId: account['accumulated'],
        ...dto,
      },
      organizationId,
      ACTOR,
    );

  /** A manual entry, as a person would post one. */
  const post = (date: string, lines: Array<[key: string, debit: number, credit: number]>): Promise<JournalEntry> =>
    dataSource.transaction((manager) =>
      posting.createWithManager(
        manager,
        {
          date,
          description: 'QA asiento manual',
          journalId: generalJournalId,
          lines: lines.map(([key, debit, credit]) => ({ accountId: account[key], debit, credit })),
        } as CreateJournalEntryDto,
        organizationId,
        { actorUserId: ACTOR },
      ),
    );

  const balance = (key: string, asOf = '2026-12-31') => balances.balanceOf(account[key], { organizationId, ledgerId, asOf });

  const linesOf = async (entryId: string) =>
    dataSource.query<Array<{ account_id: string; debit: string; credit: string }>>(
      `SELECT "account_id", "debit"::text, "credit"::text FROM "journal_entry_lines" WHERE "journal_entry_id" = $1 ORDER BY "debit" DESC, "credit" DESC`,
      [entryId],
    );

  /**
   * `work` with the clock — `Date` alone — stopped at `instant`: «today» for a reversal whose month
   * is closed. Timers, ticks and the driver's I/O keep running.
   */
  async function atInstant<T>(instant: string, work: () => Promise<T>): Promise<T> {
    jest.useFakeTimers({
      now: new Date(instant),
      doNotFake: [
        'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
        'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
        'clearInterval', 'setTimeout', 'clearTimeout',
      ],
    });
    try {
      return await work();
    } finally {
      jest.useRealTimers();
    }
  }

  /** The report and both of its lists on a day, whole. */
  const reconcile = async (asOf: string) => ({
    report: await capitalization.reconciliation(organizationId, asOf),
    unlinked: (await capitalization.unlinkedAssets(organizationId, asOf, resolvePaging(1, 500))).rows,
    untraced: (await capitalization.untracedPostings(organizationId, asOf, resolvePaging(1, 500))).rows,
  });
  const rowOf = (report: { accounts: Array<{ accountId: string }> }, key: string) => report.accounts.find((row) => row.accountId === account[key]);
  /** On every account and in the totals: the difference is what the ledger has with no asset behind it, less what the register has with no source. */
  const expectExplained = (report: Awaited<ReturnType<FixedAssetCapitalizationService['reconciliation']>>) => {
    for (const row of report.accounts) expect([row.code, Math.round(row.difference * 100)]).toEqual([row.code, Math.round((row.untraced - row.unlinked) * 100)]);
    expect(Math.round(report.totals.difference * 100)).toBe(Math.round((report.totals.untraced - report.totals.unlinked) * 100));
  };

  it('refuses an asset that does not say how its cost entered the ledger', async () => {
    await expect(register({ name: 'QA-Sin origen', cost: 1_000 })).rejects.toMatchObject({ messageKey: 'fixed_assets.capitalization_required' });
  });

  it('posts the acquisition: the cost in, its opening depreciation with it, the rest against the account named', async () => {
    const migrated = await register({
      name: 'QA-Camión migrado',
      cost: 100_000,
      acquisitionDate: '2024-01-01',
      openingAccumulatedDepreciation: 20_000,
      openingDepreciatedThrough: '2025-12',
      // Brought over on the opening date, against opening equity.
      capitalization: { method: FixedAssetCapitalization.POSTED, offsetAccountId: account['equity'], date: '2026-01-01' },
    });
    expect(migrated).toMatchObject({ capitalizationMethod: 'POSTED', capitalizationOffsetAccountId: account['equity'] });
    const entry = await dataSource.getRepository(JournalEntry).findOneByOrFail({ id: migrated.capitalizationEntryId as string });
    expect(entry.date).toBe('2026-01-01');
    expect(describeEntryOrigin(entry)).toMatchObject({
      locked: true,
      reason: 'fixed-asset-acquisition',
      document: { type: 'fixed-asset-acquisition', id: migrated.id, route: `/accounting/fixed-assets/${migrated.id}` },
    });
    expect((await linesOf(entry.id)).map((line) => [line.account_id, Number(line.debit), Number(line.credit)])).toEqual([
      [account['equipment'], 100_000, 0],
      [account['equity'], 0, 80_000],
      [account['accumulated'], 0, 20_000],
    ]);
    expect(await balance('equipment')).toBe(100_000);
    expect(await balance('accumulated')).toBe(-20_000);

    await expect(
      register({ name: 'QA-Contra sí mismo', cost: 1_000, capitalization: { method: FixedAssetCapitalization.POSTED, offsetAccountId: account['equipment'] } }),
    ).rejects.toMatchObject({ messageKey: 'fixed_assets.capitalization_offset_is_asset_account' });
  });

  it('posts it again when what values the asset changes before anything was charged, and reverses it when the asset is deleted', async () => {
    const before = await balance('equipment');
    const desk = await register({ name: 'QA-Escritorio', cost: 10_000, capitalization: { method: FixedAssetCapitalization.POSTED, offsetAccountId: account['bank'] } });
    expect(await balance('equipment')).toBe(before + 10_000);
    const first = desk.capitalizationEntryId as string;

    const corrected = await assets.update(desk.id, { cost: 12_000 }, organizationId, ACTOR);
    expect(corrected.capitalizationEntryId).not.toBe(first);
    expect((await dataSource.getRepository(JournalEntry).findOneByOrFail({ id: first })).isReversed).toBe(true);
    expect(await balance('equipment')).toBe(before + 12_000);
    expect(await balance('bank')).toBe(-(12_000 + 0));

    await assets.remove(desk.id, organizationId, ACTOR);
    expect(await balance('equipment')).toBe(before);
    expect(await balance('bank')).toBe(0);
  });

  it('links an entry already in the books — never for more than it debited the asset\'s account', async () => {
    const purchase = await post('2026-03-05', [
      ['equipment', 200_000, 0],
      ['bank', 0, 200_000],
    ]);
    const lathe = await register({ name: 'QA-Torno', cost: 150_000, capitalization: { method: FixedAssetCapitalization.JOURNAL_ENTRY, journalEntryId: purchase.id } });
    expect(lathe).toMatchObject({ capitalizationMethod: 'JOURNAL_ENTRY', capitalizationEntryId: purchase.id });
    await expect(
      register({ name: 'QA-Fresadora', cost: 60_000, capitalization: { method: FixedAssetCapitalization.JOURNAL_ENTRY, journalEntryId: purchase.id } }),
    ).rejects.toMatchObject({ messageKey: 'fixed_assets.capitalization_exceeds_source', params: { available: 50_000, account: '1504' } });
    await register({ name: 'QA-Fresadora', cost: 50_000, capitalization: { method: FixedAssetCapitalization.JOURNAL_ENTRY, journalEntryId: purchase.id } });

    // Registered in full: it is no longer waiting to be an asset.
    const waiting = await capitalization.sources(organizationId, resolvePaging(1, 100));
    expect(waiting.rows.map((row) => row.journalEntryId)).not.toContain(purchase.id);

    const transfer = await post('2026-03-06', [
      ['bank', 5_000, 0],
      ['payable', 0, 5_000],
    ]);
    await expect(
      register({ name: 'QA-Otro', cost: 1_000, capitalization: { method: FixedAssetCapitalization.JOURNAL_ENTRY, journalEntryId: transfer.id } }),
    ).rejects.toMatchObject({ messageKey: 'fixed_assets.capitalization_source_not_on_account' });

    // The cost of two assets is in that entry: it is not reversed from under them.
    await expect(
      entries.reverse(purchase.id, organizationId, { reversalDate: '2026-03-31', reason: 'QA' } as never, { actorUserId: ACTOR }),
    ).rejects.toMatchObject({ messageKey: 'journal_entries.entry_capitalized_fixed_assets' });
  });

  it('links a posted supplier bill, and lists what of it is still waiting to be registered', async () => {
    const [supplier] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO "suppliers" ("organization_id", "name") VALUES ($1, 'QA-Proveedor') RETURNING "id"`,
      [organizationId],
    );
    const billEntry = await post('2026-04-10', [
      ['equipment', 300_000, 0],
      ['payable', 0, 300_000],
    ]);
    const [bill] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO "vendor_bills" ("organization_id", "vendor_id", "date", "dueDate", "total", "total_in_base_currency", "version", "status", "journal_entry_id", "supplier_invoice_number")
       VALUES ($1, $2, '2026-04-10', '2026-05-10', 300000, 300000, 1, 'OPEN', $3, 'QA-B-001') RETURNING "id"`,
      [organizationId, supplier.id, billEntry.id],
    );
    const listed = (await capitalization.sources(organizationId, resolvePaging(1, 100))).rows.find((row) => row.journalEntryId === billEntry.id);
    expect(listed).toMatchObject({ kind: 'VENDOR_BILL', id: bill.id, supplier: 'QA-Proveedor', reference: 'QA-B-001', debited: 300_000, available: 300_000 });

    const press = await register({ name: 'QA-Prensa', cost: 100_000, vendorBillId: bill.id });
    expect(press).toMatchObject({ capitalizationMethod: 'VENDOR_BILL', vendorBillId: bill.id });
    const after = (await capitalization.sources(organizationId, resolvePaging(1, 100))).rows.find((row) => row.journalEntryId === billEntry.id);
    expect(after).toMatchObject({ registered: 100_000, available: 200_000 });

    const [draft] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO "vendor_bills" ("organization_id", "vendor_id", "date", "dueDate", "total", "total_in_base_currency", "version", "status")
       VALUES ($1, $2, '2026-04-11', '2026-05-11', 1000, 1000, 1, 'DRAFT') RETURNING "id"`,
      [organizationId, supplier.id],
    );
    await expect(register({ name: 'QA-Borrador', cost: 1_000, vendorBillId: draft.id })).rejects.toMatchObject({
      messageKey: 'fixed_assets.capitalization_bill_not_posted',
    });
    // The bill that bought it is not deleted from under it.
    await expect(dataSource.query(`DELETE FROM "vendor_bills" WHERE "id" = $1`, [bill.id])).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: '23503' }),
    });
  });

  it('puts each account\'s register against its balance, and explains the difference to the cent', async () => {
    // An asset registered before the rule, and a posting nobody registered.
    const legacy = await dataSource.getRepository(FixedAsset).save(
      dataSource.getRepository(FixedAsset).create({
        organizationId,
        number: 'AF-2026-LEGACY1',
        name: 'QA-Antiguo',
        cost: 7_000,
        residualValue: 0,
        accumulatedDepreciation: 0,
        bookValue: 7_000,
        usefulLifeMonths: 60,
        depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
        acquisitionDate: '2026-01-15',
        inServiceDate: '2026-01-15',
        status: FixedAssetStatus.IN_USE,
        assetAccountId: account['equipment'],
        accumulatedDepreciationAccountId: account['accumulated'],
      }),
    );
    const stray = await post('2026-05-20', [
      ['equipment', 3_000, 0],
      ['bank', 0, 3_000],
    ]);

    const { report, unlinked, untraced } = await reconcile('2026-12-31');
    // Register: the migrated truck 100 000, the lathe 150 000, the milling machine 50 000, the press
    // 100 000 and the legacy asset 7 000. Ledger: those but the legacy one, the stray 3 000, and the
    // 200 000 of the bill still waiting to be registered. The desk, posted twice and deleted, left
    // two acquisitions and their reversals: they cancel, and are not listed.
    expect(rowOf(report, 'equipment')).toMatchObject({ role: 'COST', assets: 5, register: 407_000, ledger: 603_000, difference: 196_000, unlinked: 7_000, untraced: 203_000 });
    expect(rowOf(report, 'accumulated')).toMatchObject({ role: 'ACCUMULATED', register: 20_000, ledger: 20_000, difference: 0, untraced: 0, unlinked: 0 });
    expectExplained(report);
    expect(report.counts).toEqual({ unlinkedAssets: 1, untracedPostings: 2 });
    expect(unlinked).toEqual([expect.objectContaining({ id: legacy.id, reason: 'NEVER_LINKED', cost: 7_000, entryId: null, disposalDate: null })]);
    expect(untraced.map((row) => [row.entryId, row.amount])).toEqual(
      expect.arrayContaining([
        [stray.id, 3_000],
        [expect.any(String), 200_000],
      ]),
    );
    expect(untraced).toHaveLength(2);
    // The net carrying amount: cost less accumulated depreciation, the register's against the ledger's.
    expect(report.totals).toEqual({ register: 387_000, ledger: 583_000, difference: 196_000, untraced: 203_000, unlinked: 7_000 });

    // Linked, the legacy asset leaves the list: its acquisition posted now.
    await assets.capitalize(legacy.id, { method: FixedAssetCapitalization.POSTED, offsetAccountId: account['bank'] }, organizationId, ACTOR);
    const relinked = await reconcile('2026-12-31');
    expect(relinked.unlinked).toEqual([]);
    expect(rowOf(relinked.report, 'equipment')).toMatchObject({ register: 407_000, ledger: 610_000, difference: 203_000, unlinked: 0, untraced: 203_000 });
    expectExplained(relinked.report);

    // On a date before the purchases: the lathe, the milling machine and the press were in service
    // since February, and their bill and entry had not reached the ledger yet.
    const early = await reconcile('2026-02-28');
    expect(rowOf(early.report, 'equipment')).toMatchObject({ register: 407_000, ledger: 107_000, difference: -300_000, unlinked: 300_000, untraced: 0 });
    expectExplained(early.report);
    expect(early.unlinked.map((row) => [row.name, row.reason])).toEqual([
      ['QA-Torno', 'SOURCE_LATER'],
      ['QA-Fresadora', 'SOURCE_LATER'],
      ['QA-Prensa', 'SOURCE_LATER'],
    ]);
    expect(early.unlinked.find((row) => row.name === 'QA-Prensa')).toMatchObject({ entryDate: '2026-04-10' });
  });

  it('counts each charge from its entry, keeps a disposed asset with no source as unlinked, and explains what a correction left on a day between', async () => {
    await make('vehicles', '1505', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.DEBIT);
    await make('vehiclesAccumulated', '1592', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.CREDIT);
    await make('gain', '4901', AccountType.REVENUE, AccountCategory.NON_OPERATING_REVENUE, AccountNature.CREDIT);
    await make('loss', '5901', AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, AccountNature.DEBIT);
    const onVehicles = { assetAccountId: account['vehicles'], accumulatedDepreciationAccountId: account['vehiclesAccumulated'], depreciationExpenseAccountId: account['depreciation'] };

    // In service in March; its bill reached the ledger in May. March and April are charged.
    const invoice = await post('2026-05-15', [
      ['vehicles', 60_000, 0],
      ['payable', 0, 60_000],
    ]);
    const van = await register({ name: 'QA-Furgoneta', cost: 60_000, acquisitionDate: '2026-03-01', ...onVehicles, capitalization: { method: FixedAssetCapitalization.JOURNAL_ENTRY, journalEntryId: invoice.id } });
    await atInstant('2026-05-05T12:00:00Z', () =>
      depreciation.runMonthlyDepreciation(organizationId, '2026-04-30', { trigger: DepreciationRunTrigger.MANUAL, ranByUserId: ACTOR }),
    );

    const april = await reconcile('2026-04-30');
    // Its two months are in the ledger and in the register: the accumulated account agrees — the
    // asset counts from the day it was acquired, each charge from its own entry.
    expect(rowOf(april.report, 'vehiclesAccumulated')).toMatchObject({ assets: 1, register: 2_000, ledger: 2_000, difference: 0 });
    // Its cost is not in the ledger yet: the bill is posted later, and the report says so.
    expect(rowOf(april.report, 'vehicles')).toMatchObject({ register: 60_000, ledger: 0, difference: -60_000, unlinked: 60_000, untraced: 0 });
    expect(april.unlinked.find((row) => row.id === van.id)).toMatchObject({ reason: 'SOURCE_LATER', entryId: invoice.id, entryDate: '2026-05-15' });
    expectExplained(april.report);
    expect(rowOf((await reconcile('2026-05-31')).report, 'vehicles')).toMatchObject({ register: 60_000, ledger: 60_000, difference: 0, unlinked: 0 });

    // An asset registered before the rule, with its opening depreciation, sold in June: the cost it
    // takes out of the ledger was never put in by the register — it is still unlinked on the day.
    const oldCar = await dataSource.getRepository(FixedAsset).save(
      dataSource.getRepository(FixedAsset).create({
        organizationId,
        number: 'AF-2025-LEGACY2',
        name: 'QA-Auto antiguo',
        cost: 30_000,
        residualValue: 0,
        openingAccumulatedDepreciation: 6_000,
        accumulatedDepreciation: 6_000,
        bookValue: 24_000,
        depreciatedThrough: '2026-05-31',
        usefulLifeMonths: 60,
        depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
        acquisitionDate: '2025-08-01',
        inServiceDate: '2025-08-01',
        status: FixedAssetStatus.IN_USE,
        ...onVehicles,
      }),
    );
    await atInstant('2026-06-12T12:00:00Z', () =>
      assets.dispose(
        oldCar.id,
        { disposalDate: '2026-06-10', salePrice: 20_000, disposalReason: 'QA venta', cashAccountId: account['bank'], gainOnDisposalAccountId: account['gain'], lossOnDisposalAccountId: account['loss'] },
        organizationId,
        ACTOR,
      ),
    );
    const june = await reconcile('2026-06-30');
    expect(rowOf(june.report, 'vehicles')).toMatchObject({ assets: 1, register: 60_000, ledger: 30_000, difference: -30_000, unlinked: 30_000, untraced: 0 });
    // Its opening 6 000 was never in the ledger, and the sale took it out with the rest.
    expect(rowOf(june.report, 'vehiclesAccumulated')).toMatchObject({ assets: 1, register: 2_000, ledger: -4_000, difference: -6_000, unlinked: 6_000, untraced: 0 });
    expect(june.unlinked.find((row) => row.id === oldCar.id)).toMatchObject({ reason: 'NEVER_LINKED', cost: 30_000, openingAccumulated: 6_000, disposalDate: '2026-06-10' });
    expectExplained(june.report);
    // Before the sale it was held, and unlinked just the same.
    expect(rowOf((await reconcile('2026-06-09')).report, 'vehicles')).toMatchObject({ register: 90_000, ledger: 60_000, difference: -30_000, unlinked: 30_000 });

    // Posted here in July, its month closed, and corrected in November to the entry that bought
    // it: the July acquisition is reversed on the day of the correction. On a day between, the
    // ledger still had it — and the report names it, instead of leaving 10 000 unexplained.
    const trailer = await register({ name: 'QA-Remolque', cost: 10_000, acquisitionDate: '2026-07-01', ...onVehicles, capitalization: { method: FixedAssetCapitalization.POSTED, offsetAccountId: account['bank'] } });
    const julyAcquisition = trailer.capitalizationEntryId as string;
    await dataSource.getRepository(AccountingPeriod).update({ organizationId, name: '2026-07' }, { status: PeriodStatus.CLOSED });
    const trailerBill = await post('2026-08-05', [
      ['vehicles', 10_000, 0],
      ['payable', 0, 10_000],
    ]);
    await atInstant('2026-11-20T12:00:00Z', () =>
      assets.capitalize(trailer.id, { method: FixedAssetCapitalization.JOURNAL_ENTRY, journalEntryId: trailerBill.id }, organizationId, ACTOR),
    );
    const [reversal] = await dataSource.query<Array<{ date: string }>>(`SELECT "date"::text AS "date" FROM "journal_entries" WHERE "reverses_entry_id" = $1`, [julyAcquisition]);
    expect(reversal.date).toBe('2026-11-20');
    const september = await reconcile('2026-09-30');
    // Register: the van and the trailer. Ledger: the van's bill, the old car's sale, the July
    // acquisition not yet reversed and the trailer's bill.
    expect(rowOf(september.report, 'vehicles')).toMatchObject({ register: 70_000, ledger: 50_000, untraced: 10_000, unlinked: 30_000, difference: -20_000 });
    expect(september.untraced.filter((row) => row.accountId === account['vehicles']).map((row) => [row.entryId, row.amount])).toEqual([[julyAcquisition, 10_000]]);
    expectExplained(september.report);
    // Once reversed, the two cancel and neither is listed.
    const december = await reconcile('2026-12-31');
    expect(december.untraced.filter((row) => row.accountId === account['vehicles'])).toEqual([]);
    expect(rowOf(december.report, 'vehicles')).toMatchObject({ register: 70_000, ledger: 40_000, untraced: 0, unlinked: 30_000, difference: -30_000 });
    expectExplained(december.report);

    // Linked by the migration to a bill voided before the rule: in the ledger until its reversal,
    // and from then on the register carries its cost with no source.
    const [supplier] = await dataSource.query<Array<{ id: string }>>(`INSERT INTO "suppliers" ("organization_id", "name") VALUES ($1, 'QA-Proveedor anulado') RETURNING "id"`, [organizationId]);
    const voidedEntry = await post('2026-08-10', [
      ['vehicles', 5_000, 0],
      ['payable', 0, 5_000],
    ]);
    await entries.reverse(voidedEntry.id, organizationId, { reversalDate: '2026-08-20', reason: 'QA anulación' } as never, { actorUserId: ACTOR });
    const [voided] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO "vendor_bills" ("organization_id", "vendor_id", "date", "dueDate", "total", "total_in_base_currency", "version", "status", "journal_entry_id", "supplier_invoice_number")
       VALUES ($1, $2, '2026-08-10', '2026-09-10', 5000, 5000, 1, 'VOID', $3, 'QA-B-VOID') RETURNING "id"`,
      [organizationId, supplier.id, voidedEntry.id],
    );
    const trolley = await dataSource.getRepository(FixedAsset).save(
      dataSource.getRepository(FixedAsset).create({
        organizationId,
        number: 'AF-2026-LEGACY3',
        name: 'QA-Carretilla',
        cost: 5_000,
        residualValue: 0,
        accumulatedDepreciation: 0,
        bookValue: 5_000,
        usefulLifeMonths: 60,
        depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
        acquisitionDate: '2026-08-10',
        inServiceDate: '2026-08-10',
        status: FixedAssetStatus.IN_USE,
        capitalizationMethod: FixedAssetCapitalization.VENDOR_BILL,
        vendorBillId: voided.id,
        ...onVehicles,
      }),
    );
    const beforeVoid = await reconcile('2026-08-15');
    expect(beforeVoid.unlinked.map((row) => row.id)).not.toContain(trolley.id);
    expectExplained(beforeVoid.report);
    const afterVoid = await reconcile('2026-08-31');
    expect(afterVoid.unlinked.find((row) => row.id === trolley.id)).toMatchObject({ reason: 'SOURCE_REVERSED', entryId: voidedEntry.id });
    // The bill's entry and its reversal cancel, and neither is listed.
    expect(afterVoid.untraced.map((row) => row.entryId)).not.toContain(voidedEntry.id);
    expectExplained(afterVoid.report);

    // Sold in December, the van: the months it was still due are charged by the disposal's own run,
    // in entries of their own — the register's, traced like any run's. They read as 6 000 «with no
    // asset behind them» on an accumulated account that agreed to the cent.
    await atInstant('2026-12-20T12:00:00Z', () =>
      assets.dispose(
        van.id,
        { disposalDate: '2026-12-15', salePrice: 50_000, disposalReason: 'QA venta', cashAccountId: account['bank'], gainOnDisposalAccountId: account['gain'], lossOnDisposalAccountId: account['loss'] },
        organizationId,
        ACTOR,
      ),
    );
    const [{ disposalRunEntries }] = await dataSource.query<Array<{ disposalRunEntries: number }>>(
      `SELECT COUNT(*)::int AS "disposalRunEntries" FROM "journal_entries" WHERE "organization_id" = $1 AND "system_reason" = 'asset-disposal'`,
      [organizationId],
    );
    expect(disposalRunEntries).toBeGreaterThan(0);
    const sold = await reconcile('2026-12-31');
    expect(rowOf(sold.report, 'vehiclesAccumulated')).toMatchObject({ register: 0, ledger: -6_000, untraced: 0, unlinked: 6_000, difference: -6_000 });
    expect(sold.untraced.filter((row) => row.accountId === account['vehiclesAccumulated'])).toEqual([]);
    expectExplained(sold.report);
  });
  it('brings to the close what it will charge and whether the register agrees with the ledger, from the real computations', async () => {
    const provider = new FixedAssetClosingBlockersProvider(dataSource, depreciation, capitalization, { register: jest.fn() } as never);
    const december = { organizationId, periodId: 'p-2026-12', startDate: '2026-12-01', endDate: '2026-12-31' };
    const preview = await depreciation.preview(organizationId, '2026-12-31');
    const report = await capitalization.reconciliation(organizationId, '2026-12-31');
    expect(preview.assets.length).toBeGreaterThan(0);
    const [charge, register] = await provider.blockersFor(december);
    expect(charge).toMatchObject({
      id: 'fixed-assets-depreciation',
      descriptionKey: 'fixed_assets.closing.depreciation_ready',
      isCompleted: true,
      params: { count: preview.assets.length, amount: preview.total },
    });
    expect(register).toMatchObject({
      id: 'fixed-assets-reconciliation',
      descriptionKey: 'fixed_assets.closing.register_not_reconciled',
      isCompleted: false,
      params: { date: '2026-12-31', difference: report.totals.difference, unlinked: report.counts.unlinkedAssets, untraced: report.counts.untracedPostings },
    });

    // Without an expense account to charge, the close cannot depreciate them: the line says which.
    await dataSource.query(`UPDATE "organization_settings" SET "default_depreciation_expense_account_id" = NULL WHERE "organization_id" = $1`, [organizationId]);
    try {
      const [blocked] = await provider.blockersFor(december);
      expect(blocked).toMatchObject({ descriptionKey: 'fixed_assets.closing.depreciation_skipped', isCompleted: false, params: { count: expect.any(Number) } });
    } finally {
      await dataSource.query(`UPDATE "organization_settings" SET "default_depreciation_expense_account_id" = $2 WHERE "organization_id" = $1`, [organizationId, account['depreciation']]);
    }

    // Before its first asset, the register has nothing to say.
    expect(await provider.blockersFor({ ...december, startDate: '2023-12-01', endDate: '2023-12-31' })).toEqual([]);
  });
});
