import { DataSource, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FixedAssetsService } from './fixed-assets.service';
import { TaxBookService } from './tax-book.service';
import { FixedAssetCapitalizationService } from './capitalization.service';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';
import { DepreciationService } from './depreciation.service';
import { AssetPostingService } from './asset-posting.service';
import { DepreciationMethod, FixedAsset, FixedAssetCapitalization, FixedAssetStatus } from './entities/fixed-asset.entity';
import { FixedAssetDepreciation } from './entities/fixed-asset-depreciation.entity';
import { DepreciationRunTrigger, FixedAssetDepreciationRun } from './entities/fixed-asset-depreciation-run.entity';
import { describeEntryOrigin } from '../journal-entries/entry-origin';
import { allowPostingsThrough } from '../accounting/period-status';
import { CreateFixedAssetDto } from './dto/fixed-asset.dto';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { Journal } from '../journal-entries/entities/journal.entity';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { Ledger } from '../accounting/entities/ledger.entity';
import { AccountingPeriod, PeriodStatus } from '../accounting/entities/accounting-period.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { AccountCategory, AccountNature, AccountType } from '../chart-of-accounts/enums/account-enums';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { testExchangeRateResolver } from '../currencies/exchange-rate-resolver.testing';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../common/database/testing/integration-db';
import { SYSTEM_JOURNALS } from '../contracts/ledger-posting/system-journals';

/**
 * The fixed-asset register against a real database and the real ledger: registering, the monthly
 * charge (with its catch-up and its per-month record), what may still be edited, deletion, and a
 * disposal with its gain or loss.
 */
describeWithDb('fixed-asset register', () => {
  jest.setTimeout(180_000);

  let dataSource: DataSource;
  let organizationId: string;
  let ledgerId: string;
  let assets: FixedAssetsService;
  let depreciation: DepreciationService;
  let balances: AccountBalancesService;
  const account: Record<string, string> = {};
  const ACTOR = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'fixed-asset register');

    const audit = new AuditTrailService(dataSource.getRepository(AuditLog));
    balances = new AccountBalancesService(dataSource);
    const entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null), announcePending: jest.fn() } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      audit,
      testExchangeRateResolver(dataSource),
    );
    const posting = new AssetPostingService(entries);
    const lookup = new JournalLookupService(dataSource.getRepository(Journal));
    const i18n = new I18nService();
    const taxBooks = new TaxBookService(dataSource, i18n);
    depreciation = new DepreciationService(
      posting,
      new SchedulerLockService(dataSource),
      dataSource,
      new OrgSettingsService(dataSource.getRepository(OrganizationSettings)),
      lookup,
      taxBooks,
    );
    const narrative = new LedgerNarrativeService(i18n);
    assets = new FixedAssetsService(
      dataSource.getRepository(FixedAsset),
      dataSource,
      posting,
      lookup,
      depreciation,
      taxBooks,
      i18n,
      new FixedAssetCapitalizationService(dataSource, posting, lookup, narrative),
    );

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
    // The journals a provisioned company has — taken from the catalogue the provisioner reads, not
    // picked by hand. Inserting the one journal the code under test needed is how this suite stayed
    // green while every real company refused to dispose of an asset (FINB-10).
    await dataSource.getRepository(Journal).save(
      Object.values(SYSTEM_JOURNALS).map((journal) => ({
        organizationId,
        code: journal.code,
        name: journal.code,
        type: journal.type,
      })),
    );

    // Open months to post into, from the earliest asset below to the latest disposal.
    const periods = [];
    for (let index = 0; index < 14; index++) {
      const start = new Date(Date.UTC(2025, 10 + index, 1));
      const end = new Date(Date.UTC(2025, 11 + index, 0));
      periods.push({
        organizationId,
        name: start.toISOString().slice(0, 7),
        startDate: start.toISOString().slice(0, 10) as unknown as Date,
        endDate: end.toISOString().slice(0, 10) as unknown as Date,
        status: PeriodStatus.OPEN,
      });
    }
    await dataSource.getRepository(AccountingPeriod).save(periods);

    const make = async (key: string, code: string, type: AccountType, category: AccountCategory, nature: AccountNature) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code,
          name: { es: key },
          type,
          category,
          nature,
          isPostable: true,
          isActive: true,
        }),
      );
      account[key] = saved.id;
    };
    await make('bank', '1102', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('vehicles', '1503', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.DEBIT);
    await make('accumulated', '1591', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.CREDIT);
    await make('depreciation', '5201', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await make('vehicleDepreciation', '5202', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await make('gain', '4901', AccountType.REVENUE, AccountCategory.NON_OPERATING_REVENUE, AccountNature.CREDIT);
    await make('loss', '5901', AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, AccountNature.DEBIT);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultDepreciationExpenseAccountId: account['depreciation'],
        defaultAccumulatedDepreciationAccountId: account['accumulated'],
      }),
    );
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  const register = (overrides: Partial<CreateFixedAssetDto> = {}) =>
    assets.create(
      {
        name: 'Camioneta de reparto',
        acquisitionDate: '2026-01-10',
        cost: 120_000,
        usefulLifeMonths: 60,
        depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
        assetAccountId: account['vehicles'],
        accumulatedDepreciationAccountId: account['accumulated'],
        // Bought from the bank: the register posts its acquisition (FINB-15).
        capitalization: { method: FixedAssetCapitalization.POSTED, offsetAccountId: account['bank'] },
        ...overrides,
      },
      organizationId,
      ACTOR,
    );

  const balance = (key: string, asOf: string) =>
    balances.balanceOf(account[key], { organizationId, ledgerId, asOf });

  /** A person at the board. */
  const MANUAL = { trigger: DepreciationRunTrigger.MANUAL, ranByUserId: ACTOR } as const;

  /**
   * `work` with the clock — `Date` alone — stopped at `instant`: «today» for the run's guard and
   * the posting horizon. Timers, ticks and the driver's I/O keep running.
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

  const chargesOf = (fixedAssetId: string) =>
    dataSource.getRepository(FixedAssetDepreciation).find({ where: { organizationId, fixedAssetId }, order: { periodEnd: 'ASC' } });

  it('numbers each asset in its year of acquisition and refuses figures that do not add up', async () => {
    const first = await register();
    const second = await register({ name: 'Montacargas' });
    expect(first.number).toMatch(/^AF-2026-\d{6}$/);
    expect(Number(second.number.slice(-6))).toBe(Number(first.number.slice(-6)) + 1);
    expect(first.bookValue).toBe(120_000);
    expect(first.inServiceDate).toBe('2026-01-10');

    await expect(register({ residualValue: 200_000 })).rejects.toMatchObject({ messageKey: 'fixed_assets.residual_above_cost' });
    await expect(register({ inServiceDate: '2025-12-01' })).rejects.toMatchObject({
      messageKey: 'fixed_assets.in_service_before_acquisition',
    });
    await expect(register({ assetAccountId: '00000000-0000-4000-8000-0000000000aa' })).rejects.toMatchObject({
      messageKey: 'fixed_assets.account_not_found',
    });
  });

  it('charges every month an asset is due, once, and records each month', async () => {
    const asset = await register({ inServiceDate: '2026-01-15', depreciationExpenseAccountId: account['vehicleDepreciation'] });

    const preview = await depreciation.preview(organizationId, '2026-03-31');
    expect(preview.journalEntryId).toBeNull();
    expect(preview.assets.find((row) => row.id === asset.id)).toMatchObject({ months: 3, amount: 6_000 });

    const run = await depreciation.runMonthlyDepreciation(organizationId, '2026-03-31', MANUAL);
    expect(run.journalEntryId).not.toBeNull();
    expect(run.runId).not.toBeNull();
    expect(run.assets.find((row) => row.id === asset.id)).toMatchObject({ months: 3, amount: 6_000 });

    // To the asset's own expense account, not the company's default.
    expect(await balance('vehicleDepreciation', '2026-03-31')).toBe(6_000);

    const months = await dataSource.getRepository(FixedAssetDepreciation).find({
      where: { organizationId, fixedAssetId: asset.id },
      order: { periodEnd: 'ASC' },
    });
    expect(months.map((row) => row.periodEnd)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(months[2]).toMatchObject({ accumulatedAfter: 6_000, bookValueAfter: 114_000 });
    // Each month in its own entry, on its own last day — January's expense is January's (QA R3-M14).
    expect(new Set(months.map((row) => row.journalEntryId)).size).toBe(3);
    // Posted by the system for the asset register, and typed so: not a MANUAL entry.
    const types = await dataSource.query(
      `SELECT DISTINCT "entryType" FROM "journal_entries" WHERE "id" = ANY($1::uuid[])`,
      [months.map((row) => row.journalEntryId)],
    );
    expect(types).toEqual([{ entryType: 'SYSTEM_GENERATED' }]);
    expect(await balance('vehicleDepreciation', '2026-01-31')).toBe(2_000);
    expect(await balance('vehicleDepreciation', '2026-02-28')).toBe(4_000);

    // The run is a document: what set it going, who, through which month, what it charged — and
    // each month it charged, and each entry it posted, lead back to it (FINB-17).
    const record = await dataSource.getRepository(FixedAssetDepreciationRun).findOneByOrFail({ id: run.runId! });
    expect(record).toMatchObject({ trigger: DepreciationRunTrigger.MANUAL, ranByUserId: ACTOR, periodEnd: '2026-03-31', fixedAssetId: null });
    expect(record.total).toBe(run.total);
    expect(record.assetCount).toBe(run.assets.length);
    expect(months.every((row) => row.runId === run.runId)).toBe(true);
    const runEntries = await dataSource.getRepository(JournalEntry).find({ where: { id: In(months.map((row) => row.journalEntryId)) }, order: { date: 'ASC' } });
    expect(runEntries.map((row) => row.idempotencyKey)).toEqual([
      `depreciation-run:${run.runId}:2026-01-31`,
      `depreciation-run:${run.runId}:2026-02-28`,
      `depreciation-run:${run.runId}:2026-03-31`,
    ]);
    expect(runEntries.every((row) => row.systemReason === 'depreciation-run' && row.postedByUserId === ACTOR)).toBe(true);
    expect(describeEntryOrigin(runEntries[0])).toMatchObject({
      locked: true,
      document: { type: 'depreciation-run', id: run.runId, route: `/accounting/fixed-assets/depreciation-runs/${run.runId}` },
    });

    // The board reads it back: listed among the runs that charged the asset, with every month.
    const listed = await depreciation.listRuns(organizationId, { fixedAssetId: asset.id });
    expect(listed.rows.map((row) => row.id)).toEqual([run.runId]);
    const detail = await depreciation.findRun(run.runId!, organizationId);
    expect(detail.charges.filter((row) => row.fixedAssetId === asset.id).map((row) => [row.periodEnd, row.amount])).toEqual([
      ['2026-01-31', 2_000],
      ['2026-02-28', 2_000],
      ['2026-03-31', 2_000],
    ]);
    expect(detail.entries.map((row) => row.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    await expect(depreciation.findRun('00000000-0000-4000-8000-0000000000ab', organizationId)).rejects.toMatchObject({
      messageKey: 'fixed_assets.depreciation_run_not_found',
    });

    // Again, for the same month: nothing more for this asset.
    const runsBefore = await dataSource.getRepository(FixedAssetDepreciationRun).countBy({ organizationId });
    const again = await depreciation.runMonthlyDepreciation(organizationId, '2026-03-31', MANUAL);
    expect(again.assets.find((row) => row.id === asset.id)).toBeUndefined();
    // A run that charged nothing leaves no record: there is nothing it did to account for.
    expect(again).toMatchObject({ assets: [], runId: null, journalEntryId: null, total: 0 });
    expect(await dataSource.getRepository(FixedAssetDepreciationRun).countBy({ organizationId })).toBe(runsBefore);
    expect(await balance('vehicleDepreciation', '2026-03-31')).toBe(6_000);

    const schedule = await assets.schedule(asset.id, organizationId);
    expect(schedule.posted).toHaveLength(3);
    expect(schedule.projected).toHaveLength(57);
    const projectedTotal = schedule.projected.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100;
    expect(projectedTotal).toBe(114_000);
  });

  it('picks up a migrated asset from its opening balance instead of charging its past again', async () => {
    const asset = await register({
      acquisitionDate: '2024-01-01',
      openingAccumulatedDepreciation: 48_000,
      openingDepreciatedThrough: '2025-12',
    });
    expect(asset).toMatchObject({ accumulatedDepreciation: 48_000, bookValue: 72_000, depreciatedThrough: '2025-12-31' });

    const preview = await depreciation.preview(organizationId, '2026-01-31');
    expect(preview.assets.find((row) => row.id === asset.id)).toMatchObject({ months: 1, amount: 2_000 });
  });

  it('keeps what valued the asset once a month is charged, and lets the estimates change', async () => {
    const asset = await register({ acquisitionDate: '2025-11-01' });
    await depreciation.runMonthlyDepreciation(organizationId, '2025-11-30', MANUAL);

    await expect(assets.update(asset.id, { cost: 150_000 }, organizationId)).rejects.toMatchObject({
      messageKey: 'fixed_assets.valuation_locked_after_depreciation',
    });
    const longer = await assets.update(asset.id, { usefulLifeMonths: 120, name: 'Camioneta (reasignada)' }, organizationId);
    expect(longer).toMatchObject({ usefulLifeMonths: 120, name: 'Camioneta (reasignada)', cost: 120_000 });

    await expect(assets.remove(asset.id, organizationId)).rejects.toMatchObject({
      messageKey: 'fixed_assets.asset_in_books_dispose_instead',
    });
    const mistaken = await register({ name: 'Registrado por error' });
    await expect(assets.remove(mistaken.id, organizationId)).resolves.toBeUndefined();
  });

  it('charges up to the month before a sale, then books the loss and takes the asset off the books', async () => {
    const asset = await register({ acquisitionDate: '2026-01-05', name: 'Furgón' });

    await expect(
      assets.dispose(asset.id, { disposalDate: '2026-04-20', salePrice: 100_000, disposalReason: 'Venta' }, organizationId, ACTOR),
    ).rejects.toMatchObject({ messageKey: 'fixed_assets.proceeds_account_required' });

    const sold = await assets.dispose(
      asset.id,
      {
        disposalDate: '2026-04-20',
        salePrice: 100_000,
        disposalReason: 'Venta a tercero',
        cashAccountId: account['bank'],
        lossOnDisposalAccountId: account['loss'],
      },
      organizationId,
      ACTOR,
    );

    // January to March charged first: 6 000; carrying 114 000; sold for 100 000.
    expect(sold).toMatchObject({
      status: FixedAssetStatus.SOLD,
      accumulatedDepreciation: 6_000,
      disposalDate: '2026-04-20',
      disposalProceeds: 100_000,
      depreciatedThrough: '2026-03-31',
    });
    expect(sold.disposalJournalEntryId).not.toBeNull();
    const entry = await dataSource.getRepository(JournalEntry).findOne({
      where: { id: sold.disposalJournalEntryId as string },
      relations: ['lines'],
    });
    const lines = (entry?.lines ?? []).map((line) => ({ accountId: line.accountId, debit: Number(line.debit), credit: Number(line.credit) }));
    expect(lines).toEqual(
      expect.arrayContaining([
        { accountId: account['bank'], debit: 100_000, credit: 0 },
        { accountId: account['accumulated'], debit: 6_000, credit: 0 },
        { accountId: account['vehicles'], debit: 0, credit: 120_000 },
        { accountId: account['loss'], debit: 14_000, credit: 0 },
      ]),
    );
    // The disposal is a document of the register: its entry says so, cannot be edited in the
    // journal, and leads back to the asset (FINB-17: it was a manual-looking entry, reason NULL).
    expect(entry).toMatchObject({ systemReason: 'fixed-asset-disposal', idempotencyKey: `fixed-asset-disposal:${asset.id}` });
    expect(describeEntryOrigin(entry!)).toEqual({
      locked: true,
      reason: 'fixed-asset-disposal',
      document: { type: 'fixed-asset-disposal', id: asset.id, route: `/accounting/fixed-assets/${asset.id}` },
    });

    // The three months it was still due were charged by the disposal's own run, which names the
    // asset and who disposed of it — not by an anonymous «monthly» run.
    const caughtUp = await chargesOf(asset.id);
    expect(caughtUp.map((row) => row.periodEnd)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    const runIds = [...new Set(caughtUp.map((row) => row.runId))];
    expect(runIds).toHaveLength(1);
    const disposalRun = await dataSource.getRepository(FixedAssetDepreciationRun).findOneByOrFail({ id: runIds[0]! });
    expect(disposalRun).toMatchObject({
      trigger: DepreciationRunTrigger.DISPOSAL,
      fixedAssetId: asset.id,
      ranByUserId: ACTOR,
      periodEnd: '2026-03-31',
      assetCount: 1,
      chargeCount: 3,
      total: 6_000,
    });
    const catchUpEntries = await dataSource.getRepository(JournalEntry).find({ where: { id: In(caughtUp.map((row) => row.journalEntryId)) } });
    expect(catchUpEntries.map((row) => row.systemReason)).toEqual(['asset-disposal', 'asset-disposal', 'asset-disposal']);
    expect(catchUpEntries.map((row) => describeEntryOrigin(row).document?.route)).toEqual(
      Array(3).fill(`/accounting/fixed-assets/depreciation-runs/${disposalRun.id}`),
    );

    await expect(
      assets.dispose(asset.id, { disposalDate: '2026-05-01', salePrice: 0, disposalReason: 'Otra vez' }, organizationId, ACTOR),
    ).rejects.toMatchObject({ messageKey: 'fixed_assets.asset_not_found_has_already_disposed' });
    await expect(assets.update(asset.id, { name: 'x' }, organizationId)).rejects.toMatchObject({
      messageKey: 'fixed_assets.asset_retired_cannot_edit',
    });
  });

  it('names an asset it could not charge rather than failing the whole run', async () => {
    const orphan = await register({ name: 'Sin cuentas' });
    await dataSource.query(`UPDATE fixed_asset SET accumulated_depreciation_account_id = NULL WHERE id = $1`, [orphan.id]);
    // Neither the asset nor the company names an account to credit.
    const settings = await dataSource.getRepository(OrganizationSettings).findOneByOrFail({ organizationId });
    settings.defaultAccumulatedDepreciationAccountId = null;
    await dataSource.getRepository(OrganizationSettings).save(settings);

    const preview = await depreciation.preview(organizationId, '2026-02-28');
    expect(preview.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: orphan.id, reason: 'missing_accounts' })]),
    );
  });

  /**
   * A month is depreciated once it has ended in the company's calendar (FINB-13).
   *
   * On the 7th of November a run for November posted the whole month dated the 30th, and the
   * preview offered to post 25 months that had not happened: expense ahead of its time, and an
   * asset carried below its value meanwhile.
   */
  it('previews a month that has not ended without posting it, unless that month is being closed', async () => {
    const asset = await register({ acquisitionDate: '2026-06-02', name: 'Compresor' });

    await atInstant('2026-06-07T15:00:00Z', async () => {
      // Santo Domingo, the suite's calendar: the 7th of June, 11:00.
      const june = await depreciation.preview(organizationId, '2026-06-30');
      expect(june).toMatchObject({
        postable: false,
        notPostable: { key: 'fixed_assets.depreciation_period_not_ended', params: { period: '2026-06', today: '2026-06-07' } },
      });
      // It still says what the month will charge.
      expect(june.assets.find((row) => row.id === asset.id)).toMatchObject({ months: 1, amount: 2_000 });
      // A month that has ended is postable, and a later one is not: the guard is the month, not the asset.
      expect((await depreciation.preview(organizationId, '2026-05-31')).postable).toBe(true);
      expect((await depreciation.preview(organizationId, '2029-12-31')).postable).toBe(false);

      await expect(depreciation.runMonthlyDepreciation(organizationId, '2026-06-30', MANUAL)).rejects.toMatchObject({
        messageKey: 'fixed_assets.depreciation_period_not_ended',
      });
      await expect(depreciation.runMonthlyDepreciation(organizationId, '2029-12-31', MANUAL)).rejects.toMatchObject({
        messageKey: 'fixed_assets.depreciation_period_not_ended',
      });
      expect(await chargesOf(asset.id)).toEqual([]);

      // The close of June may close it early, and charges June as it does: on the close's own
      // transaction, which says how far it closes, the month is chargeable.
      await dataSource.transaction(async (manager) => {
        await allowPostingsThrough(manager, '2026-06-30');
        await depreciation.runForPeriod(organizationId, { startDate: '2026-06-01', endDate: '2026-06-30' }, manager, ACTOR);
      });
    });

    const charged = await chargesOf(asset.id);
    expect(charged.map((row) => [row.periodEnd, row.amount])).toEqual([['2026-06-30', 2_000]]);
    const closeRun = await dataSource.getRepository(FixedAssetDepreciationRun).findOneByOrFail({ id: charged[0].runId! });
    expect(closeRun).toMatchObject({ trigger: DepreciationRunTrigger.PERIOD_CLOSE, ranByUserId: ACTOR, periodEnd: '2026-06-30' });
  });

  /**
   * Where the life sits on the calendar (FINB-12): a whole first month and no disposal month was
   * the only convention. The company chooses what a new asset follows; each asset keeps its own,
   * fixed once a month is charged; and the month an asset leaves in is charged through the day it
   * leaves, in the disposal's own entry.
   */
  it('follows the company\'s convention unless the asset names one, and keeps it once charged', async () => {
    const settings = await dataSource.getRepository(OrganizationSettings).findOneByOrFail({ organizationId });
    settings.defaultDepreciationConvention = 'MID_MONTH';
    await dataSource.getRepository(OrganizationSettings).save(settings);
    try {
      const defaulted = await register({ name: 'Convención de la empresa', acquisitionDate: '2026-02-10' });
      const named = await register({ name: 'Convención propia', acquisitionDate: '2026-02-10', depreciationConvention: 'DAILY' });
      expect(defaulted.depreciationConvention).toBe('MID_MONTH');
      expect(named.depreciationConvention).toBe('DAILY');

      // February: half a month of 2 000, and 19 days of its 28.
      const preview = await depreciation.preview(organizationId, '2026-02-28');
      expect(preview.assets.find((row) => row.id === defaulted.id)).toMatchObject({ months: 1, amount: 1_000 });
      expect(preview.assets.find((row) => row.id === named.id)).toMatchObject({ months: 1, amount: 1_357.14 });

      await depreciation.runMonthlyDepreciation(organizationId, '2026-02-28', MANUAL);
      await expect(assets.update(named.id, { depreciationConvention: 'FULL_MONTH' }, organizationId)).rejects.toMatchObject({
        messageKey: 'fixed_assets.valuation_locked_after_depreciation',
      });
    } finally {
      settings.defaultDepreciationConvention = 'FULL_MONTH';
      await dataSource.getRepository(OrganizationSettings).save(settings);
    }
  });

  it('charges the month of a disposal through the day the asset leaves, in the disposal\'s own entry', async () => {
    // 2 000 a month from the 1st of January; sold on the 20th of April.
    const asset = await register({ name: 'Grúa', acquisitionDate: '2026-01-01', depreciationConvention: 'DAILY' });
    const sold = await assets.dispose(
      asset.id,
      { disposalDate: '2026-04-20', salePrice: 100_000, disposalReason: 'Venta', cashAccountId: account['bank'], lossOnDisposalAccountId: account['loss'] },
      organizationId,
      ACTOR,
    );

    // January to March, 6 000, and twenty days of April's thirty, 1 333.33: 7 333.33 in all.
    expect(sold).toMatchObject({ status: FixedAssetStatus.SOLD, accumulatedDepreciation: 7_333.33, bookValue: 112_666.67, depreciatedThrough: '2026-04-30' });
    const charged = await chargesOf(asset.id);
    expect(charged.map((row) => [row.periodEnd, row.amount])).toEqual([
      ['2026-01-31', 2_000],
      ['2026-02-28', 2_000],
      ['2026-03-31', 2_000],
      ['2026-04-30', 1_333.33],
    ]);
    // April's charge is carried by the disposal's entry; all four months by the disposal's run.
    expect(charged[3].journalEntryId).toBe(sold.disposalJournalEntryId);
    expect(new Set(charged.map((row) => row.runId)).size).toBe(1);
    const run = await dataSource.getRepository(FixedAssetDepreciationRun).findOneByOrFail({ id: charged[0].runId! });
    expect(run).toMatchObject({ trigger: DepreciationRunTrigger.DISPOSAL, fixedAssetId: asset.id, periodEnd: '2026-04-30', chargeCount: 4, total: 7_333.33 });

    const entry = await dataSource.getRepository(JournalEntry).findOneOrFail({ where: { id: sold.disposalJournalEntryId! }, relations: ['lines'] });
    const lines = entry.lines.map((line) => ({ accountId: line.accountId, debit: Number(line.debit), credit: Number(line.credit) }));
    expect(lines).toEqual(
      expect.arrayContaining([
        { accountId: account['depreciation'], debit: 1_333.33, credit: 0 },
        { accountId: account['accumulated'], debit: 0, credit: 1_333.33 },
        { accountId: account['bank'], debit: 100_000, credit: 0 },
        { accountId: account['accumulated'], debit: 7_333.33, credit: 0 },
        { accountId: account['vehicles'], debit: 0, credit: 120_000 },
        { accountId: account['loss'], debit: 12_666.67, credit: 0 },
      ]),
    );
    expect(lines).toHaveLength(6);
  });

  it('refuses a disposal whose months due have no account to be charged to', async () => {
    const asset = await register({ name: 'Sin cuenta de gasto', acquisitionDate: '2026-01-01', depreciationConvention: 'NEXT_MONTH' });
    const settings = await dataSource.getRepository(OrganizationSettings).findOneByOrFail({ organizationId });
    const before = settings.defaultDepreciationExpenseAccountId;
    settings.defaultDepreciationExpenseAccountId = null;
    await dataSource.getRepository(OrganizationSettings).save(settings);
    try {
      await expect(
        assets.dispose(asset.id, { disposalDate: '2026-03-10', salePrice: 0, disposalReason: 'Robo' }, organizationId, ACTOR),
      ).rejects.toMatchObject({ messageKey: 'fixed_assets.disposal_depreciation_accounts_missing' });
      expect(await chargesOf(asset.id)).toEqual([]);
    } finally {
      settings.defaultDepreciationExpenseAccountId = before;
      await dataSource.getRepository(OrganizationSettings).save(settings);
    }
  });
});
