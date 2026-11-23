import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

const downloads: Array<{ filename: string; csv: string }> = [];
jest.mock('../../../core/export/csv-export', () => {
  const actual = jest.requireActual('../../../core/export/csv-export');
  return { ...actual, downloadCsv: (filename: string, csv: string) => downloads.push({ filename, csv }) };
});

// Imported after the mock, so the report writes into `downloads` instead of the browser.
import { FixedAssetFormPage } from './fixed-asset-form.page';
import { FixedAssetCategoryFormPage } from './fixed-asset-category-form.page';
import { FixedAssetCategoriesPage } from './fixed-asset-categories.page';
import { DepreciationRunPage } from './depreciation-run.page';
import { TaxDepreciationPage, defaultTaxPeriod } from './tax-depreciation.page';
import { taxYearsOf } from './fixed-asset.page';
import {
  FixedAsset,
  FixedAssetCategory,
  FixedAssetsService,
  TaxCategoryCatalogue,
  TaxDepreciationReport,
  asPercent,
  asRate,
} from '../data/fixed-assets.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';
import { authServiceMock } from '../../../../testing/service-mocks';

/**
 * Asset categories and the tax book on screen (audit 2026-11-07, FINB-16): a category gives a new
 * asset what it starts with and the authority's tax rate; the tax book travels with the asset, its
 * rates as fractions; a run of the tax books alone is offered; the report exports every page.
 */
describe('fixed-asset categories and the tax book', () => {
  const catalogue: TaxCategoryCatalogue = {
    authority: 'DGII',
    caveatKey: 'fixed_assets.tax_categories.do_caveat',
    categories: [
      { code: 'DO-1', nameKey: 'fixed_assets.tax_categories.do_1', method: 'DECLINING_BALANCE', annualRate: 0.05, legalBasis: 'Ley 11-92, art. 287, categoría 1' },
      { code: 'DO-2', nameKey: 'fixed_assets.tax_categories.do_2', method: 'DECLINING_BALANCE', annualRate: 0.25, legalBasis: 'Ley 11-92, art. 287, categoría 2' },
      { code: 'DO-3', nameKey: 'fixed_assets.tax_categories.do_3', method: 'DECLINING_BALANCE', annualRate: 0.15, legalBasis: 'Ley 11-92, art. 287, categoría 3' },
    ],
  };
  const vehicles: FixedAssetCategory = {
    id: 'cat-veh',
    code: 'VEH',
    name: 'Vehículos',
    nameTranslations: { en: 'Vehicles' },
    description: null,
    usefulLifeMonths: 60,
    depreciationMethod: 'STRAIGHT_LINE',
    decliningAnnualRate: null,
    depreciationConvention: 'FULL_MONTH',
    residualRate: 0.1,
    assetAccountId: 'acc-vehicles',
    accumulatedDepreciationAccountId: 'acc-accum',
    depreciationExpenseAccountId: null,
    gainOnDisposalAccountId: null,
    lossOnDisposalAccountId: null,
    taxCategoryCode: 'DO-2',
    taxMethod: 'DECLINING_BALANCE',
    taxAnnualRate: 0.25,
    isActive: true,
  };
  const asset = (overrides: Partial<FixedAsset> = {}): FixedAsset => ({
    id: 'fa-1',
    number: 'AF-2026-000001',
    name: 'Camioneta',
    description: null,
    branchId: null,
    acquisitionDate: '2026-01-10',
    inServiceDate: '2026-01-10',
    cost: 120_000,
    residualValue: 12_000,
    usefulLifeMonths: 60,
    depreciationMethod: 'STRAIGHT_LINE',
    decliningAnnualRate: null,
    depreciationConvention: 'FULL_MONTH',
    categoryId: 'cat-veh',
    category: { id: 'cat-veh', code: 'VEH', name: 'Vehículos', nameTranslations: { en: 'Vehicles' } },
    taxBook: null,
    bookValue: 120_000,
    accumulatedDepreciation: 0,
    openingAccumulatedDepreciation: 0,
    depreciatedThrough: null,
    status: 'IN_USE',
    assetAccountId: 'acc-vehicles',
    accumulatedDepreciationAccountId: 'acc-accum',
    depreciationExpenseAccountId: null,
    vendorBillId: null,
    disposalDate: null,
    disposalProceeds: null,
    disposalReason: null,
    disposalJournalEntryId: null,
    createdAt: '2026-01-10T12:00:00.000Z',
    ...overrides,
  });
  const report = (page: number, hasMore: boolean): TaxDepreciationReport => ({
    period: { from: '2026-01', to: '2026-12' },
    totals: { assets: 2, basis: 132_000, openingAccumulated: 0, deduction: 34_200, closingAccumulated: 34_200, taxValue: 97_800, accountingDepreciation: 25_600, accountingCarrying: 106_400, difference: 8_600 },
    byTaxCategory: [{ taxCategoryCode: 'DO-2', method: 'DECLINING_BALANCE', annualRate: 0.25, assets: 1, basis: 120_000, openingAccumulated: 0, deduction: 30_000, closingAccumulated: 30_000, taxValue: 90_000, accountingDepreciation: 21_600, accountingCarrying: 98_400, difference: 8_400 }],
    assets: {
      rows: [
        {
          assetId: `fa-${page}`,
          number: `AF-2026-00000${page}`,
          name: page === 1 ? 'Camioneta' : 'Servidor',
          categoryCode: 'VEH',
          categoryName: 'Vehículos',
          categoryNameTranslations: { en: 'Vehicles' },
          taxCategoryCode: page === 1 ? 'DO-2' : null,
          method: page === 1 ? 'DECLINING_BALANCE' : 'STRAIGHT_LINE',
          annualRate: page === 1 ? 0.25 : 0.35,
          inServiceDate: '2026-01-10',
          disposalDate: null,
          basis: page === 1 ? 120_000 : 12_000,
          openingAccumulated: 0,
          deduction: page === 1 ? 30_000 : 4_200,
          closingAccumulated: page === 1 ? 30_000 : 4_200,
          taxValue: page === 1 ? 90_000 : 7_800,
          accountingDepreciation: page === 1 ? 21_600 : 4_000,
          accountingCarrying: page === 1 ? 98_400 : 8_000,
          difference: page === 1 ? 8_400 : 200,
        },
      ],
      page,
      pageSize: 500,
      total: 2,
      hasMore,
    },
  });

  let api: Record<string, jest.Mock>;
  let dialog: { confirm: jest.Mock };

  beforeEach(() => {
    downloads.length = 0;
    api = {
      list: jest.fn().mockReturnValue(of({ rows: [], page: 1, pageSize: 50, total: 0, hasMore: false })),
      get: jest.fn().mockReturnValue(of(asset())),
      create: jest.fn().mockReturnValue(of(asset())),
      update: jest.fn().mockReturnValue(of(asset())),
      listCategories: jest.fn().mockReturnValue(of([vehicles])),
      getCategory: jest.fn().mockReturnValue(of(vehicles)),
      createCategory: jest.fn().mockReturnValue(of(vehicles)),
      updateCategory: jest.fn().mockReturnValue(of(vehicles)),
      removeCategory: jest.fn().mockReturnValue(of(undefined)),
      taxCategories: jest.fn().mockReturnValue(of(catalogue)),
      taxDepreciation: jest.fn().mockImplementation((query: { page?: number }) => of(report(query.page ?? 1, (query.page ?? 1) === 1))),
      previewDepreciation: jest.fn().mockReturnValue(
        of({ periodEnd: '2026-01-31', runId: null, journalEntryId: null, total: 0, assets: [], skipped: [], tax: { total: 50, assets: [{ id: 'fa-9', number: 'AF-2027-000009', name: 'Estantería', months: 1, amount: 50 }] }, postable: true, notPostable: null }),
      ),
      runDepreciation: jest.fn().mockReturnValue(
        of({ periodEnd: '2026-01-31', runId: 'run-9', journalEntryId: null, total: 0, assets: [], skipped: [], tax: { total: 50, assets: [{ id: 'fa-9', number: 'AF-2027-000009', name: 'Estantería', months: 1, amount: 50 }] }, postable: true, notPostable: null }),
      ),
    };
    dialog = { confirm: jest.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: FixedAssetsService, useValue: api },
        { provide: NotificationService, useValue: { httpErrorMessage: jest.fn().mockReturnValue('x'), showHttpError: jest.fn(), showSuccess: jest.fn(), showError: jest.fn() } },
        { provide: DialogService, useValue: dialog },
        { provide: ChartOfAccountsApiService, useValue: { searchAccounts: () => of([]), getAccountById: (id: string) => of({ id, code: '1', name: 'x' }) } },
        { provide: BranchesService, useValue: { hasBranches: () => false, branches: () => [], mine: () => ({ branches: [], defaultBranchId: null }), ensureMine: () => Promise.resolve(), load: jest.fn() } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
        { provide: AuthService, useValue: authServiceMock({ permissions: ['fixed_assets:manage', 'fixed_assets:view'] }) },
      ],
    });
  });

  it('reads a rate kept as a fraction as a percentage, and back, to six decimals', () => {
    expect(asPercent(0.25)).toBe(25);
    expect(asPercent(0.333333)).toBe(33.3333);
    expect(asRate(35)).toBe(0.35);
    expect(asRate('')).toBeNull();
  });

  it('gives a new asset what its category gives, and the authority\'s tax book', () => {
    TestBed.overrideComponent(FixedAssetFormPage, { set: { template: '' } });
    const page = TestBed.createComponent(FixedAssetFormPage).componentInstance;
    page.ngOnInit();
    page.form.patchValue({ name: 'Camioneta', acquisitionDate: '2026-01-10', cost: 120_000 });
    page.form.controls.categoryId.setValue('cat-veh');
    expect(page.form.getRawValue()).toMatchObject({
      usefulLifeMonths: 60,
      residualValue: 12_000,
      assetAccountId: 'acc-vehicles',
      accumulatedDepreciationAccountId: 'acc-accum',
      keepTaxBook: true,
      taxCategoryCode: 'DO-2',
      taxMethod: 'DECLINING_BALANCE',
      taxRatePercent: 25,
    });
    expect(page.showTaxBook()).toBe(true);

    page.save();
    expect(api['create']).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: 'cat-veh',
        usefulLifeMonths: 60,
        residualValue: 12_000,
        taxBook: { taxCategoryCode: 'DO-2', method: 'DECLINING_BALANCE', annualRate: 0.25, openingAccumulated: 0, openingThrough: null },
      }),
    );
  });

  it('asks a declining balance for its rate, and sends it as a fraction', () => {
    TestBed.overrideComponent(FixedAssetFormPage, { set: { template: '' } });
    const page = TestBed.createComponent(FixedAssetFormPage).componentInstance;
    page.ngOnInit();
    page.form.patchValue({ name: 'Montacargas', acquisitionDate: '2026-01-10', cost: 80_000, usefulLifeMonths: 120, assetAccountId: 'a', accumulatedDepreciationAccountId: 'b', depreciationMethod: 'DECLINING_BALANCE' });
    expect(page.declining()).toBe(true);
    page.save();
    expect(api['create']).not.toHaveBeenCalled();
    expect(page.problems().map((problem) => problem.message)).toContain('fixed_assets.declining_rate_required');

    page.form.patchValue({ decliningRatePercent: 25 });
    page.save();
    // No tax book asked for: the asset says it keeps none.
    expect(api['create']).toHaveBeenCalledWith(expect.objectContaining({ depreciationMethod: 'DECLINING_BALANCE', decliningAnnualRate: 0.25, taxBook: null }));
  });

  it('sends an asset\'s tax book only when it changed, and leaves out the terms fixed once it has charged', () => {
    api['get'].mockReturnValue(
      of(asset({
        accumulatedDepreciation: 1_800,
        depreciatedThrough: '2026-01-31',
        taxBook: { id: 'tb-1', taxCategoryCode: 'DO-2', method: 'DECLINING_BALANCE', annualRate: 0.25, convention: 'FULL_MONTH', cost: 120_000, openingAccumulated: 0, openingThrough: null, accumulatedDepreciation: 2_500, taxValue: 117_500, depreciatedThrough: '2026-01-31', closedOn: null, chargedMonths: 1 },
      })),
    );
    TestBed.overrideComponent(FixedAssetFormPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(FixedAssetFormPage);
    fixture.componentRef.setInput('id', 'fa-1');
    const page = fixture.componentInstance;
    page.ngOnInit();
    expect(page.taxBookLocked()).toBe(true);
    expect(page.form.controls.taxBasis.disabled).toBe(true);
    // Charged: it cannot be dropped either.
    expect(page.form.controls.keepTaxBook.disabled).toBe(true);

    page.form.patchValue({ usefulLifeMonths: 72 });
    page.save();
    expect(api['update'].mock.calls[0][1]).not.toHaveProperty('taxBook');

    page.form.controls.taxRatePercent.setValue(15);
    page.form.controls.taxRatePercent.markAsDirty();
    page.save();
    expect(api['update'].mock.calls[1][1].taxBook).toEqual({ taxCategoryCode: 'DO-2', method: 'DECLINING_BALANCE', annualRate: 0.15 });
  });

  it('offers a run of the tax books alone, and says nothing will be posted', async () => {
    TestBed.overrideComponent(DepreciationRunPage, { set: { template: '' } });
    const page = TestBed.createComponent(DepreciationRunPage).componentInstance;
    page.ngOnInit();
    expect(page.rows()).toHaveLength(0);
    expect(page.taxRows()).toHaveLength(1);
    expect(page.empty()).toBe(false);
    expect(page.canPost()).toBe(true);
    await page.run();
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'fixed_assets.run.confirm_tax_only_message', messageParams: expect.objectContaining({ taxTotal: 50, taxCount: 1 }) }));
    expect(api['runDepreciation']).toHaveBeenCalled();
  });

  it('brings the authority\'s method and rate with its category, and saves rates as fractions', () => {
    TestBed.overrideComponent(FixedAssetCategoryFormPage, { set: { template: '' } });
    const page = TestBed.createComponent(FixedAssetCategoryFormPage).componentInstance;
    page.ngOnInit();
    page.form.patchValue({ code: 'mob', name: 'Mobiliario', residualPercent: 10 });
    page.form.controls.taxCategoryCode.setValue('DO-3');
    expect(page.form.getRawValue()).toMatchObject({ taxMethod: 'DECLINING_BALANCE', taxRatePercent: 15 });
    expect(page.taxEntry()?.legalBasis).toBe('Ley 11-92, art. 287, categoría 3');
    page.save();
    expect(api['createCategory']).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'mob', residualRate: 0.1, taxCategoryCode: 'DO-3', taxMethod: 'DECLINING_BALANCE', taxAnnualRate: 0.15, depreciationMethod: null, decliningAnnualRate: null }),
    );
  });

  it('lists the categories, with the inactive ones when asked, and deactivates one', () => {
    TestBed.overrideComponent(FixedAssetCategoriesPage, { set: { template: '' } });
    const page = TestBed.createComponent(FixedAssetCategoriesPage).componentInstance;
    page.ngOnInit();
    expect(api['listCategories']).toHaveBeenCalledWith(false);
    expect(page.taxCategoryKey('DO-2')).toBe('fixed_assets.tax_categories.do_2');
    page.setIncludeInactive(true);
    expect(api['listCategories']).toHaveBeenLastCalledWith(true);
    page.setActive(vehicles, false);
    expect(api['updateCategory']).toHaveBeenCalledWith('cat-veh', { isActive: false });
  });

  it('groups a tax book\'s months by the company\'s fiscal year', () => {
    const month = (periodEnd: string, amount: number, accumulatedAfter: number) => ({ periodEnd, amount, accumulatedAfter, bookValueAfter: 1_000 - accumulatedAfter });
    const years = taxYearsOf([month('2026-06-30', 10, 10), month('2026-07-31', 10, 20)], [month('2026-08-31', 10, 30), month('2027-07-31', 10, 40)], 7);
    expect(years).toEqual([
      { label: '2025/2026', deduction: 10, accumulatedAfter: 10, taxValueAfter: 990, state: 'posted' },
      { label: '2026/2027', deduction: 20, accumulatedAfter: 30, taxValueAfter: 970, state: 'partial' },
      { label: '2027/2028', deduction: 10, accumulatedAfter: 40, taxValueAfter: 960, state: 'projected' },
    ]);
    expect(taxYearsOf([month('2026-03-31', 5, 5)], [], 1)[0].label).toBe('2026');
  });

  it('reports the year by default, and exports every page of it with its totals', async () => {
    expect(defaultTaxPeriod(new Date(2026, 10, 23))).toEqual({ from: '2026-01', to: '2026-10' });
    TestBed.overrideComponent(TaxDepreciationPage, { set: { template: '' } });
    const page = TestBed.createComponent(TaxDepreciationPage).componentInstance;
    page.ngOnInit();
    expect(api['taxDepreciation']).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 100 }));
    expect(page.total()).toBe(2);

    await page.exportCsv();
    expect(api['taxDepreciation']).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 500 }));
    expect(downloads).toHaveLength(1);
    const csv = downloads[0].csv;
    expect(csv).toContain('AF-2026-000001');
    expect(csv).toContain('AF-2026-000002');
    // The totals of the whole period, not of a page.
    expect(csv).toContain('34200');
    expect(csv).toContain('8600');
  });

  it('refuses a period that ends before it starts, without asking the server', () => {
    TestBed.overrideComponent(TaxDepreciationPage, { set: { template: '' } });
    const page = TestBed.createComponent(TaxDepreciationPage).componentInstance;
    page.from.set('2026-12');
    page.to.set('2026-01');
    api['taxDepreciation'].mockClear();
    page.applyFilters();
    expect(page.periodValid()).toBe(false);
    expect(api['taxDepreciation']).not.toHaveBeenCalled();
  });
});
