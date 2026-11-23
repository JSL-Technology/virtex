import { DataSource, EntityManager } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FixedAssetsService } from './fixed-assets.service';
import { FixedAssetCategoriesService } from './fixed-asset-categories.service';
import { TaxBookService } from './tax-book.service';
import { FixedAssetCapitalizationService } from './capitalization.service';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { DepreciationService } from './depreciation.service';
import { AssetPostingService } from './asset-posting.service';
import { DepreciationMethod, FixedAsset, FixedAssetCapitalization } from './entities/fixed-asset.entity';
import { FixedAssetBook } from './entities/fixed-asset-book.entity';
import { DepreciationRunTrigger, FixedAssetDepreciationRun } from './entities/fixed-asset-depreciation-run.entity';
import { CreateFixedAssetDto } from './dto/fixed-asset.dto';
import { I18nService } from '../i18n/i18n.service';
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
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { testExchangeRateResolver } from '../currencies/exchange-rate-resolver.testing';
import { resolvePaging } from '../common/pagination';
import { createTestOrganization, describeWithDb, openTestDataSource } from '../common/database/testing/integration-db';
import { SYSTEM_JOURNALS } from '../contracts/ledger-posting/system-journals';

/**
 * Asset categories and the tax book (audit 2026-11-07, FINB-16), against a real database and the
 * real ledger: a category's defaults, the authority's tax categories and rates, a tax book charged
 * by the same runs as the accounting book and posted nowhere, the terms it fixes once it has
 * charged, its close on a disposal, and the period's tax depreciation against the books.
 */
describeWithDb('fixed-asset categories and the tax book', () => {
  jest.setTimeout(240_000);

  let dataSource: DataSource;
  let assets: FixedAssetsService;
  let categories: FixedAssetCategoriesService;
  let taxBooks: TaxBookService;
  let depreciation: DepreciationService;
  let balances: AccountBalancesService;
  const companies: string[] = [];
  const ACTOR = '11111111-1111-4111-8111-111111111111';
  const MANUAL = { trigger: DepreciationRunTrigger.MANUAL, ranByUserId: ACTOR } as const;

  interface Company {
    organizationId: string;
    ledgerId: string;
    account: Record<string, string>;
  }

  /**
   * The company's settings, read as the depreciation service asks for them — by their columns,
   * without the organizations module's entity: the defaults an asset falls back on.
   */
  const settingsReader = {
    getForOrg: async (organizationId: string, manager?: EntityManager) => {
      const [row] = await (manager ?? dataSource.manager).query(
        `SELECT "default_depreciation_expense_account_id" AS "defaultDepreciationExpenseAccountId",
                "default_accumulated_depreciation_account_id" AS "defaultAccumulatedDepreciationAccountId",
                "default_depreciation_convention" AS "defaultDepreciationConvention"
           FROM "organization_settings" WHERE "organization_id" = $1`,
        [organizationId],
      );
      return row ?? null;
    },
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    // The audit trail is the journal's concern, not the register's: recorded nowhere here.
    const audit = { recordWithManager: jest.fn().mockResolvedValue(undefined) };
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
      audit as never,
      testExchangeRateResolver(dataSource),
    );
    const posting = new AssetPostingService(entries);
    const lookup = new JournalLookupService(dataSource.getRepository(Journal));
    const i18n = new I18nService();
    taxBooks = new TaxBookService(dataSource, i18n);
    depreciation = new DepreciationService(
      posting,
      new SchedulerLockService(dataSource),
      dataSource,
      settingsReader as never,
      lookup,
      taxBooks,
    );
    assets = new FixedAssetsService(
      dataSource.getRepository(FixedAsset),
      dataSource,
      posting,
      lookup,
      depreciation,
      taxBooks,
      i18n,
      new FixedAssetCapitalizationService(dataSource, posting, lookup, new LedgerNarrativeService(i18n)),
    );
    categories = new FixedAssetCategoriesService(dataSource);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    // One statement per company: its books and their months leave together, which the months'
    // key — no deleting a book from under them — allows.
    for (const id of companies) await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [id]);
    await dataSource.destroy();
  });

  /** A company of `country`, its books open from July 2025 to December 2027. */
  async function company(label: string, country: string | null, fiscalYears: Array<[string, string]> = []): Promise<Company> {
    const organizationId = await createTestOrganization(dataSource, label);
    companies.push(organizationId);
    await dataSource.query(`UPDATE organizations SET country = $2, books_language = 'es' WHERE id = $1`, [organizationId, country]);
    const ledger = await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({ organizationId, name: 'Libro principal', currency: 'DOP', isDefault: true, isActive: true }),
    );
    await dataSource.getRepository(Journal).save(
      Object.values(SYSTEM_JOURNALS).map((journal) => ({ organizationId, code: journal.code, name: journal.code, type: journal.type })),
    );
    const periods = [];
    for (let index = 0; index < 30; index++) {
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
    for (const [startDate, endDate] of fiscalYears) {
      await dataSource.query(`INSERT INTO "fiscal_years" ("organization_id", "start_date", "end_date") VALUES ($1, $2, $3)`, [
        organizationId,
        startDate,
        endDate,
      ]);
    }
    const account: Record<string, string> = {};
    const make = async (key: string, code: string, type: AccountType, category: AccountCategory, nature: AccountNature) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({ organizationId, code, name: { es: key }, type, category, nature, isPostable: true, isActive: true }),
      );
      account[key] = saved.id;
    };
    await make('bank', '1102', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT);
    await make('vehicles', '1503', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.DEBIT);
    await make('equipment', '1504', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.DEBIT);
    await make('accumulated', '1591', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET, AccountNature.CREDIT);
    await make('depreciation', '5201', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT);
    await make('loss', '5901', AccountType.EXPENSE, AccountCategory.NON_OPERATING_EXPENSE, AccountNature.DEBIT);
    await dataSource.query(
      `INSERT INTO "organization_settings" ("organization_id", "base_currency", "default_depreciation_expense_account_id", "default_accumulated_depreciation_account_id")
       VALUES ($1, 'DOP', $2, $3)`,
      [organizationId, account['depreciation'], account['accumulated']],
    );
    return { organizationId, ledgerId: ledger.id, account };
  }

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

  // Bought from the bank: the register posts its acquisition (FINB-15).
  const register = (target: Company, dto: Partial<CreateFixedAssetDto> & Pick<CreateFixedAssetDto, 'name' | 'cost'>) =>
    assets.create(
      {
        acquisitionDate: '2026-01-10',
        depreciationConvention: 'FULL_MONTH',
        capitalization: { method: FixedAssetCapitalization.POSTED, offsetAccountId: target.account['bank'] },
        ...dto,
      },
      target.organizationId,
      ACTOR,
    );

  const report = (target: Company, from: string, to: string) => taxBooks.report(target.organizationId, from, to, resolvePaging(1, 100));

  describe('a Dominican company: the DGII category 2, at 25 % on the declining balance', () => {
    let dominican: Company;
    let vehicleCategoryId: string;
    let vanId: string;

    beforeAll(async () => {
      dominican = await company('tax book DO', 'DO');
    });

    it('takes its tax method and rate from the authority, and refuses a category the authority does not have', async () => {
      const vehicles = await categories.create(
        {
          code: ' veh ',
          name: 'Vehículos',
          nameTranslations: { en: 'Vehicles' },
          usefulLifeMonths: 60,
          depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
          residualRate: 0.1,
          assetAccountId: dominican.account['vehicles'],
          taxCategoryCode: 'do-2',
        },
        dominican.organizationId,
      );
      vehicleCategoryId = vehicles.id;
      expect(vehicles).toMatchObject({
        code: 'VEH',
        taxCategoryCode: 'DO-2',
        taxMethod: DepreciationMethod.DECLINING_BALANCE,
        taxAnnualRate: 0.25,
        nameTranslations: { en: 'Vehicles' },
        residualRate: 0.1,
      });

      await expect(categories.create({ code: 'VEH', name: 'Otra' }, dominican.organizationId)).rejects.toMatchObject({
        messageKey: 'fixed_assets.category_code_taken',
      });
      await expect(categories.create({ code: 'X', name: 'X', taxCategoryCode: 'DO-9' }, dominican.organizationId)).rejects.toMatchObject({
        messageKey: 'fixed_assets.tax_category_unknown',
        params: { code: 'DO-9', authority: 'DGII', known: 'DO-1, DO-2, DO-3' },
      });
      await expect(
        categories.create({ code: 'Y', name: 'Y', depreciationMethod: DepreciationMethod.DECLINING_BALANCE }, dominican.organizationId),
      ).rejects.toMatchObject({ messageKey: 'fixed_assets.declining_rate_required' });
      await expect(
        categories.create({ code: 'Z', name: 'Z', taxMethod: DepreciationMethod.STRAIGHT_LINE }, dominican.organizationId),
      ).rejects.toMatchObject({ messageKey: 'fixed_assets.tax_method_and_rate_together' });

      const catalogue = await categories.taxCatalogue(dominican.organizationId);
      expect(catalogue?.authority).toBe('DGII');
      expect(catalogue?.categories.map((entry) => [entry.code, entry.method, entry.annualRate])).toEqual([
        ['DO-1', 'DECLINING_BALANCE', 0.05],
        ['DO-2', 'DECLINING_BALANCE', 0.25],
        ['DO-3', 'DECLINING_BALANCE', 0.15],
      ]);
    });

    it('registers an asset with what its category gives, and opens its tax book on the category\'s terms', async () => {
      const van = await register(dominican, { name: 'Camioneta de reparto', cost: 120_000, categoryId: vehicleCategoryId });
      vanId = van.id;
      expect(van).toMatchObject({
        categoryId: vehicleCategoryId,
        usefulLifeMonths: 60,
        residualValue: 12_000,
        depreciationMethod: DepreciationMethod.STRAIGHT_LINE,
        assetAccountId: dominican.account['vehicles'],
        // Neither the request nor the category named it: the company's default.
        accumulatedDepreciationAccountId: dominican.account['accumulated'],
        category: { code: 'VEH', name: 'Vehículos' },
        taxBook: { taxCategoryCode: 'DO-2', method: 'DECLINING_BALANCE', annualRate: 0.25, cost: 120_000, accumulatedDepreciation: 0, chargedMonths: 0 },
      });

      // A later change to the category rewrites no asset registered from it.
      await categories.update(vehicleCategoryId, { residualRate: 0.2, usefulLifeMonths: 48 }, dominican.organizationId);
      expect(await assets.findOne(vanId, dominican.organizationId)).toMatchObject({ residualValue: 12_000, usefulLifeMonths: 60 });
    });

    it('charges both books in one run, and posts only the accounting one', async () => {
      const run = await atInstant('2026-02-05T12:00:00Z', () => depreciation.runMonthlyDepreciation(dominican.organizationId, '2026-01-31', MANUAL));
      // (120 000 − 12 000) / 60 in the books; 25 % of 120 000, a twelfth, in the tax book.
      expect(run.total).toBe(1_800);
      expect(run.tax).toMatchObject({ total: 2_500, assets: [{ id: vanId, months: 1, amount: 2_500 }] });
      expect(await balances.balanceOf(dominican.account['depreciation'], { organizationId: dominican.organizationId, ledgerId: dominican.ledgerId, asOf: '2026-01-31' })).toBe(1_800);

      const record = await dataSource.getRepository(FixedAssetDepreciationRun).findOneByOrFail({ id: run.runId as string });
      expect(record).toMatchObject({ chargeCount: 1, total: 1_800, taxChargeCount: 1, taxTotal: 2_500 });
      const detail = await depreciation.findRun(run.runId as string, dominican.organizationId);
      expect(detail.taxCharges).toEqual([
        expect.objectContaining({ fixedAssetId: vanId, periodEnd: '2026-01-31', amount: 2_500, accumulatedAfter: 2_500, bookValueAfter: 117_500 }),
      ]);

      const board = await assets.schedule(vanId, dominican.organizationId);
      expect(board.taxBook?.posted).toEqual([expect.objectContaining({ periodEnd: '2026-01-31', amount: 2_500, runId: run.runId })]);
      expect(board.taxBook?.projected[0]).toMatchObject({ periodEnd: '2026-02-28', amount: 2_500 });
    });

    it('reports the year\'s deduction, what is left and the temporary difference against the books', async () => {
      await atInstant('2027-01-05T12:00:00Z', () => depreciation.runMonthlyDepreciation(dominican.organizationId, '2026-12-31', MANUAL));
      const year = await report(dominican, '2026-01', '2026-12');
      expect(year.assets.rows).toEqual([
        expect.objectContaining({
          assetId: vanId,
          categoryCode: 'VEH',
          taxCategoryCode: 'DO-2',
          basis: 120_000,
          openingAccumulated: 0,
          deduction: 30_000,
          closingAccumulated: 30_000,
          taxValue: 90_000,
          accountingDepreciation: 21_600,
          accountingCarrying: 98_400,
          // Carried at 98 400 in the books against a tax value of 90 000: the difference deferred
          // tax is measured on.
          difference: 8_400,
        }),
      ]);
      expect(year.totals).toMatchObject({ assets: 1, deduction: 30_000, taxValue: 90_000, difference: 8_400 });
      expect(year.byTaxCategory).toEqual([expect.objectContaining({ taxCategoryCode: 'DO-2', assets: 1, deduction: 30_000 })]);

      // The next year applies the rate to what was left at its start: 25 % of 90 000.
      const january = await atInstant('2027-02-05T12:00:00Z', () => depreciation.runMonthlyDepreciation(dominican.organizationId, '2027-01-31', MANUAL));
      expect(january.tax.total).toBe(1_875);
    });

    it('closes the tax book on a disposal, after charging what it was still due', async () => {
      const disposed = await atInstant('2027-03-20T12:00:00Z', () =>
        assets.dispose(
          vanId,
          {
            disposalDate: '2027-03-15',
            salePrice: 80_000,
            disposalReason: 'QA venta',
            cashAccountId: dominican.account['bank'],
            lossOnDisposalAccountId: dominican.account['loss'],
          },
          dominican.organizationId,
          ACTOR,
        ),
      );
      expect(disposed.status).toBe('SOLD');
      const book = await dataSource.getRepository(FixedAssetBook).findOneByOrFail({ fixedAssetId: vanId });
      // February charged by the disposal's run; March, under a full-month convention, nothing.
      expect(book).toMatchObject({ closedOn: '2027-03-15', accumulatedDepreciation: 33_750, depreciatedThrough: '2027-02-28' });

      const year = await report(dominican, '2027-01', '2027-12');
      expect(year.assets.rows).toEqual([
        expect.objectContaining({
          assetId: vanId,
          disposalDate: '2027-03-15',
          deduction: 3_750,
          taxValue: 86_250,
          // It left the books: it carries neither a carrying amount nor a difference.
          accountingCarrying: null,
          difference: null,
        }),
      ]);
      // A run after it charges it nothing.
      const april = await atInstant('2027-05-05T12:00:00Z', () => depreciation.runMonthlyDepreciation(dominican.organizationId, '2027-04-30', MANUAL));
      expect(april.tax.total).toBe(0);
    });

    it('refuses to delete a category assets were registered in, and stops offering one deactivated', async () => {
      await expect(categories.remove(vehicleCategoryId, dominican.organizationId)).rejects.toMatchObject({
        messageKey: 'fixed_assets.category_in_use',
        params: { dependents: [{ label: 'common.dependents.fixed_asset', count: 1 }] },
      });
      await categories.update(vehicleCategoryId, { isActive: false, nameTranslations: { en: '' } }, dominican.organizationId);
      const inactive = await categories.findOne(vehicleCategoryId, dominican.organizationId);
      // A translation sent empty is removed.
      expect(inactive).toMatchObject({ isActive: false, nameTranslations: {} });
      expect((await categories.findAll(dominican.organizationId)).map((row) => row.code)).not.toContain('VEH');
      expect((await categories.findAll(dominican.organizationId, true)).map((row) => row.code)).toContain('VEH');
      await expect(register(dominican, { name: 'Otra camioneta', cost: 50_000, categoryId: vehicleCategoryId })).rejects.toMatchObject({
        messageKey: 'fixed_assets.category_inactive',
        params: { code: 'VEH' },
      });
      // One nothing was registered in is deleted.
      const unused = await categories.create({ code: 'TMP', name: 'Temporal' }, dominican.organizationId);
      await categories.remove(unused.id, dominican.organizationId);
      expect((await categories.findAll(dominican.organizationId, true)).map((row) => row.code)).not.toContain('TMP');
    });
  });

  describe('a straight line the law states as a rate, and the terms a tax book fixes', () => {
    let target: Company;
    let serverId: string;

    beforeAll(async () => {
      target = await company('tax book SL', 'DO');
    });

    it('deducts the rate on the basis exactly, and fixes the basis once it has charged', async () => {
      const server = await register(target, {
        name: 'Servidor',
        cost: 12_000,
        acquisitionDate: '2026-01-01',
        usefulLifeMonths: 36,
        assetAccountId: target.account['equipment'],
        taxBook: { method: DepreciationMethod.STRAIGHT_LINE, annualRate: 0.35 },
      });
      serverId = server.id;
      expect(server.taxBook).toMatchObject({ taxCategoryCode: null, method: 'STRAIGHT_LINE', annualRate: 0.35, cost: 12_000 });

      const year = await atInstant('2027-01-05T12:00:00Z', () => depreciation.runMonthlyDepreciation(target.organizationId, '2026-12-31', MANUAL));
      // 35 % of 12 000: 350 a month, 4 200 the year.
      expect(year.tax.total).toBe(4_200);
      expect(year.total).toBe(4_000);

      await expect(assets.update(serverId, { taxBook: { cost: 10_000 } }, target.organizationId)).rejects.toMatchObject({
        messageKey: 'fixed_assets.tax_book_terms_fixed',
        // Named in each reader's language, not by the field's name in the code.
        params: { fields: { es: 'Base fiscal', en: 'Tax basis', pt: 'Base fiscal' } },
      });
      await expect(assets.update(serverId, { cost: 13_000 }, target.organizationId)).rejects.toMatchObject({
        messageKey: 'fixed_assets.valuation_locked_after_depreciation',
        params: { fields: { es: 'Costo', en: 'Cost' } },
      });
      await expect(assets.update(serverId, { taxBook: null }, target.organizationId)).rejects.toMatchObject({
        messageKey: 'fixed_assets.tax_book_has_charges',
        params: { months: 12 },
      });
    });

    it('applies a new rate to the basis from the next month on', async () => {
      const revised = await assets.update(serverId, { taxBook: { annualRate: 0.3 } }, target.organizationId);
      expect(revised.taxBook).toMatchObject({ annualRate: 0.3, cost: 12_000, accumulatedDepreciation: 4_200 });
      const january = await atInstant('2027-02-05T12:00:00Z', () => depreciation.runMonthlyDepreciation(target.organizationId, '2027-01-31', MANUAL));
      // 30 % of 12 000: 300 — not the 7 800 left spread over what a 40-month life leaves.
      expect(january.tax.assets).toEqual([expect.objectContaining({ id: serverId, amount: 300 })]);
    });

    it('opens, follows and removes a book that has charged nothing', async () => {
      // Bought in January 2027, registered then: its acquisition is posted on its own day.
      await atInstant('2027-01-20T12:00:00Z', async () => {
        const printer = await register(target, { name: 'Impresora', cost: 5_000, usefulLifeMonths: 24, assetAccountId: target.account['equipment'], acquisitionDate: '2027-01-10' });
        expect(printer.taxBook).toBeNull();
        const opened = await assets.update(printer.id, { taxBook: { method: DepreciationMethod.STRAIGHT_LINE, annualRate: 0.25 } }, target.organizationId);
        expect(opened.taxBook).toMatchObject({ cost: 5_000, chargedMonths: 0 });
        // Its basis was the cost: it follows a correction of the cost made before anything was charged.
        const corrected = await assets.update(printer.id, { cost: 6_000 }, target.organizationId);
        expect(corrected.taxBook).toMatchObject({ cost: 6_000 });
        const removed = await assets.update(printer.id, { taxBook: null }, target.organizationId);
        expect(removed.taxBook).toBeNull();
      });
    });

    it('keeps an asset charged only in its tax book: it is retired, not deleted, and its book cannot be deleted under it', async () => {
      const shelf = await atInstant('2027-01-20T12:00:00Z', () => register(target, {
        name: 'Estantería',
        cost: 2_400,
        acquisitionDate: '2027-01-15',
        usefulLifeMonths: 24,
        assetAccountId: target.account['equipment'],
        // The books start the month after; the tax book, the month it entered service.
        depreciationConvention: 'NEXT_MONTH',
        taxBook: { method: DepreciationMethod.STRAIGHT_LINE, annualRate: 0.25, convention: 'FULL_MONTH' },
      }));
      const january = await atInstant('2027-02-06T12:00:00Z', () => depreciation.runMonthlyDepreciation(target.organizationId, '2027-01-31', MANUAL));
      expect(january.assets.map((row) => row.id)).not.toContain(shelf.id);
      expect(january.tax.assets).toEqual(expect.arrayContaining([expect.objectContaining({ id: shelf.id, amount: 50 })]));

      await expect(assets.remove(shelf.id, target.organizationId)).rejects.toMatchObject({
        messageKey: 'fixed_assets.asset_in_books_dispose_instead',
      });
      const book = await dataSource.getRepository(FixedAssetBook).findOneByOrFail({ fixedAssetId: shelf.id });
      // The database refuses it too: the months deducted are history.
      await expect(dataSource.query(`DELETE FROM "fixed_asset_books" WHERE "id" = $1`, [book.id])).rejects.toMatchObject({
        driverError: expect.objectContaining({ code: '23503' }),
      });
    });
  });

  describe('books kept by the tax law: the accounting book on the declining balance', () => {
    let target: Company;

    beforeAll(async () => {
      target = await company('tax book DB', 'DO');
    });

    it('applies the yearly rate to the value at the year\'s start, run after run, not to what each month leaves', async () => {
      const category = await categories.create(
        { code: 'EQ', name: 'Equipos', usefulLifeMonths: 120, depreciationMethod: DepreciationMethod.DECLINING_BALANCE, decliningAnnualRate: 0.25, assetAccountId: target.account['equipment'], taxCategoryCode: 'DO-2' },
        target.organizationId,
      );
      const asset = await register(target, { name: 'Montacargas', cost: 120_000, acquisitionDate: '2026-01-05', categoryId: category.id });
      expect(asset).toMatchObject({ depreciationMethod: 'DECLINING_BALANCE', decliningAnnualRate: 0.25 });
      // One run a month, as the scheduler runs them: each resumes in the middle of the year.
      const months = [];
      for (const periodEnd of ['2026-01-31', '2026-02-28', '2026-03-31']) {
        const run = await depreciation.runMonthlyDepreciation(target.organizationId, periodEnd, MANUAL);
        months.push(run.assets.find((row) => row.id === asset.id)?.amount);
      }
      // 25 % of 120 000, a twelfth a month — never 117 500 × 25 % / 12 = 2 447.92 in February.
      expect(months).toEqual([2_500, 2_500, 2_500]);

      // Its opening, too, is stated at the close of a fiscal year.
      await expect(
        register(target, {
          name: 'Montacargas usado',
          cost: 80_000,
          acquisitionDate: '2024-03-01',
          categoryId: category.id,
          openingAccumulatedDepreciation: 20_000,
          openingDepreciatedThrough: '2025-11',
        }),
      ).rejects.toMatchObject({ messageKey: 'fixed_assets.declining_opening_not_year_end', params: { month: '2025-11', yearEnd: '2024-12' } });
    });
  });

  describe('a fiscal year from July', () => {
    let target: Company;

    beforeAll(async () => {
      target = await company('tax book FY', 'DO', [
        ['2024-07-01', '2025-06-30'],
        ['2025-07-01', '2026-06-30'],
        ['2026-07-01', '2027-06-30'],
      ]);
    });

    const truck = (openingThrough: string) =>
      register(target, {
        name: 'Camión',
        cost: 50_000,
        acquisitionDate: '2024-01-01',
        usefulLifeMonths: 60,
        assetAccountId: target.account['vehicles'],
        openingAccumulatedDepreciation: 15_000,
        openingDepreciatedThrough: '2025-12',
        taxBook: { taxCategoryCode: 'DO-2', openingAccumulated: 10_000, openingThrough },
        // Brought over on the opening date: its cost and its opening depreciation enter the ledger then.
        capitalization: { method: FixedAssetCapitalization.POSTED, offsetAccountId: target.account['bank'], date: '2026-01-01' },
      });

    it('states a declining balance\'s opening at the close of a fiscal year, and applies the rate to the value at its start', async () => {
      await expect(truck('2025-12')).rejects.toMatchObject({
        messageKey: 'fixed_assets.declining_opening_not_year_end',
        params: { month: '2025-12', yearEnd: '2025-06' },
      });
      const asset = await truck('2025-06');
      expect(asset.taxBook).toMatchObject({ method: 'DECLINING_BALANCE', annualRate: 0.25, openingAccumulated: 10_000, openingThrough: '2025-06' });

      // July 2025 to January 2026 at 25 % of the 40 000 left at the year's start.
      const january = await depreciation.runMonthlyDepreciation(target.organizationId, '2026-01-31', MANUAL);
      expect(january.tax.total).toBe(5_833.33);
      // The rest of that year, then July 2026 on the next year's base: 25 % of 30 000, a twelfth.
      await depreciation.runMonthlyDepreciation(target.organizationId, '2026-06-30', MANUAL);
      const july = await depreciation.runMonthlyDepreciation(target.organizationId, '2026-07-31', MANUAL);
      expect(july.tax.total).toBe(625);

      const year = await report(target, '2025-07', '2026-06');
      expect(year.assets.rows[0]).toMatchObject({ openingAccumulated: 10_000, deduction: 10_000, closingAccumulated: 20_000, taxValue: 30_000 });
    });
  });
});

