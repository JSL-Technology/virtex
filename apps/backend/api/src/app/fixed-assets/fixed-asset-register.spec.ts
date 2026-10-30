import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FixedAssetsService } from './fixed-assets.service';
import { DepreciationService } from './depreciation.service';
import { AssetPostingService } from './asset-posting.service';
import { DepreciationMethod, FixedAsset, FixedAssetStatus } from './entities/fixed-asset.entity';
import { FixedAssetDepreciation } from './entities/fixed-asset-depreciation.entity';
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
    depreciation = new DepreciationService(
      posting,
      new SchedulerLockService(dataSource),
      dataSource,
      new OrgSettingsService(dataSource.getRepository(OrganizationSettings)),
      lookup,
    );
    assets = new FixedAssetsService(dataSource.getRepository(FixedAsset), dataSource, posting, lookup, depreciation);

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
    await dataSource.getRepository(Journal).save([
      { organizationId, code: 'GENERAL', name: 'Diario general', type: 'GENERAL' as const },
      { organizationId, code: 'DEPREC', name: 'Diario de depreciación', type: 'GENERAL' as const },
      { organizationId, code: 'ACT-FIJOS', name: 'Activos fijos', type: 'GENERAL' as const },
    ]);

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
        ...overrides,
      },
      organizationId,
      ACTOR,
    );

  const balance = (key: string, asOf: string) =>
    balances.balanceOf(account[key], { organizationId, ledgerId, asOf });

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

    const run = await depreciation.runMonthlyDepreciation(organizationId, '2026-03-31');
    expect(run.journalEntryId).not.toBeNull();
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
    expect(await balance('vehicleDepreciation', '2026-01-31')).toBe(2_000);
    expect(await balance('vehicleDepreciation', '2026-02-28')).toBe(4_000);

    // Again, for the same month: nothing more for this asset.
    const again = await depreciation.runMonthlyDepreciation(organizationId, '2026-03-31');
    expect(again.assets.find((row) => row.id === asset.id)).toBeUndefined();
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
    await depreciation.runMonthlyDepreciation(organizationId, '2025-11-30');

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
});
