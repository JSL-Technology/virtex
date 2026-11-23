import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@virtex/shared/ui-i18n';
import { of } from 'rxjs';
import { FixedAssetsPage } from './fixed-assets.page';
import { FixedAssetFormPage } from './fixed-asset-form.page';
import { FixedAssetDisposePage, carryingOnDisposal } from './fixed-asset-dispose.page';
import { DepreciationRunPage, previousMonth } from './depreciation-run.page';
import { DepreciationRunsPage, depreciationRunTriggerKey } from './depreciation-runs.page';
import { DepreciationRunDetailPage } from './depreciation-run-detail.page';
import { FixedAsset, FixedAssetSchedule, FixedAssetsService, hasBeenDepreciated } from '../data/fixed-assets.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';
import { authServiceMock } from '../../../../testing/service-mocks';

describe('fixed assets', () => {
  const asset = (overrides: Partial<FixedAsset> = {}): FixedAsset => ({
    id: 'fa-1',
    number: 'AF-2026-000001',
    name: 'Camioneta',
    description: null,
    branchId: null,
    acquisitionDate: '2026-01-10',
    inServiceDate: '2026-01-10',
    cost: 120_000,
    residualValue: 0,
    usefulLifeMonths: 60,
    depreciationMethod: 'STRAIGHT_LINE',
    decliningAnnualRate: null,
    depreciationConvention: 'FULL_MONTH',
    categoryId: null,
    category: null,
    taxBook: null,
    bookValue: 120_000,
    accumulatedDepreciation: 0,
    openingAccumulatedDepreciation: 0,
    depreciatedThrough: null,
    status: 'IN_USE',
    assetAccountId: 'acc-asset',
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

  const run = () => ({
    id: 'run-1',
    periodEnd: '2026-03-31',
    trigger: 'MANUAL' as const,
    fixedAsset: null,
    ranByUserId: 'u-1',
    ranByName: 'Ana Pérez',
    assetCount: 1,
    chargeCount: 2,
    total: 4_000,
    taxChargeCount: 0,
    taxTotal: 0,
    createdAt: '2026-04-02T14:00:00.000Z',
  });
  const noTax = { total: 0, assets: [] };

  let api: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;

  function configure() {
    api = {
      list: jest.fn().mockReturnValue(of({ rows: [asset()], page: 1, pageSize: 50, total: 1, hasMore: false })),
      get: jest.fn().mockReturnValue(of(asset())),
      schedule: jest.fn().mockReturnValue(of({ posted: [], projected: [] })),
      create: jest.fn().mockReturnValue(of(asset())),
      update: jest.fn().mockReturnValue(of(asset())),
      dispose: jest.fn().mockReturnValue(of(asset({ status: 'SOLD' }))),
      previewDepreciation: jest.fn().mockReturnValue(
        of({ periodEnd: '2026-03-31', journalEntryId: null, total: 6_000, assets: [{ id: 'fa-1', number: 'AF-2026-000001', name: 'Camioneta', months: 3, amount: 6_000 }], skipped: [], tax: noTax, postable: true, notPostable: null }),
      ),
      runDepreciation: jest.fn().mockReturnValue(
        of({ periodEnd: '2026-03-31', runId: 'run-1', journalEntryId: 'je-1', total: 6_000, assets: [{ id: 'fa-1', number: 'AF-2026-000001', name: 'Camioneta', months: 3, amount: 6_000 }], skipped: [], tax: noTax, postable: true, notPostable: null }),
      ),
      listRuns: jest.fn().mockReturnValue(of({ rows: [run()], page: 1, pageSize: 50, total: 1, hasMore: false })),
      getRun: jest.fn().mockReturnValue(
        of({
          ...run(),
          charges: [
            { fixedAssetId: 'fa-1', number: 'AF-2026-000001', name: 'Camioneta', periodEnd: '2026-02-28', amount: 2_000, accumulatedAfter: 4_000, bookValueAfter: 116_000, journalEntryId: 'je-2' },
            { fixedAssetId: 'fa-1', number: 'AF-2026-000001', name: 'Camioneta', periodEnd: '2026-03-31', amount: 2_000, accumulatedAfter: 6_000, bookValueAfter: 114_000, journalEntryId: 'je-3' },
          ],
          entries: [
            { id: 'je-2', entryNumber: 'DEPREC-2026-000002', date: '2026-02-28', total: 2_000 },
            { id: 'je-3', entryNumber: 'DEPREC-2026-000003', date: '2026-03-31', total: 2_000 },
          ],
          taxCharges: [],
        }),
      ),
      listCategories: jest.fn().mockReturnValue(of([])),
      taxCategories: jest.fn().mockReturnValue(of(null)),
    };
    notifications = {
      httpErrorMessage: jest.fn().mockReturnValue('x'),
      showHttpError: jest.fn(),
      showSuccess: jest.fn(),
      showError: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: FixedAssetsService, useValue: api },
        { provide: NotificationService, useValue: notifications },
        { provide: DialogService, useValue: { confirm: jest.fn().mockResolvedValue(true), prompt: jest.fn() } },
        { provide: ChartOfAccountsApiService, useValue: { searchAccounts: () => of([]), getAccountById: (id: string) => of({ id, code: '1', name: 'x' }) } },
        { provide: BranchesService, useValue: { hasBranches: () => false, branches: () => [], mine: () => ({ branches: [], defaultBranchId: null }), ensureMine: () => Promise.resolve(), load: jest.fn() } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
        { provide: AuthService, useValue: authServiceMock({ permissions: ['fixed_assets:manage'] }) },
      ],
    });
  }

  beforeEach(() => configure());

  it('knows an asset has been depreciated here only once a run moved it off its opening balance', () => {
    expect(hasBeenDepreciated(asset())).toBe(false);
    expect(hasBeenDepreciated(asset({ openingAccumulatedDepreciation: 48_000, accumulatedDepreciation: 48_000 }))).toBe(false);
    expect(hasBeenDepreciated(asset({ openingAccumulatedDepreciation: 48_000, accumulatedDepreciation: 50_000 }))).toBe(true);
  });

  it('lists the assets in use by default, and asks again when a filter changes', () => {
    TestBed.overrideComponent(FixedAssetsPage, { set: { template: '' } });
    const page = TestBed.createComponent(FixedAssetsPage).componentInstance;
    page.ngOnInit();
    expect(api['list']).toHaveBeenCalledWith(expect.objectContaining({ status: 'IN_USE', page: 1 }));
    expect(page.totals()).toEqual({ cost: 120_000, accumulated: 0, book: 120_000 });

    page.search.set('  camion ');
    page.statusFilter.set('');
    page.applyFilters();
    expect(api['list']).toHaveBeenLastCalledWith(expect.objectContaining({ status: null, search: 'camion' }));
  });

  it('registers an asset with what the form says, the in-service date following the acquisition', () => {
    TestBed.overrideComponent(FixedAssetFormPage, { set: { template: '' } });
    const page = TestBed.createComponent(FixedAssetFormPage).componentInstance;
    page.ngOnInit();
    page.form.patchValue({
      name: ' Camioneta ',
      acquisitionDate: '2026-02-03',
      cost: 120_000.004,
      usefulLifeMonths: 60,
      assetAccountId: 'acc-asset',
      accumulatedDepreciationAccountId: 'acc-accum',
    });
    expect(page.form.controls.inServiceDate.value).toBe('2026-02-03');
    page.save();
    expect(api['create']).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Camioneta', cost: 120_000, inServiceDate: '2026-02-03', openingAccumulatedDepreciation: 0 }),
    );
    // No convention chosen: none is sent, and the server applies the company's.
    expect(api['create'].mock.calls[0][0]).not.toHaveProperty('depreciationConvention');
  });

  it('offers every convention, and the company\'s, and sends the one the asset names', () => {
    TestBed.overrideComponent(FixedAssetFormPage, { set: { template: '' } });
    const page = TestBed.createComponent(FixedAssetFormPage).componentInstance;
    page.ngOnInit();
    expect(page['conventions']).toEqual(['FULL_MONTH', 'NEXT_MONTH', 'MID_MONTH', 'DAILY']);
    // A new asset starts on the company's convention: an empty choice.
    expect(page.form.controls.depreciationConvention.value).toBe('');
    page.form.patchValue({
      name: 'Grúa',
      acquisitionDate: '2026-02-03',
      cost: 50_000,
      usefulLifeMonths: 60,
      depreciationConvention: 'DAILY',
      assetAccountId: 'acc-asset',
      accumulatedDepreciationAccountId: 'acc-accum',
    });
    page.save();
    expect(api['create']).toHaveBeenCalledWith(expect.objectContaining({ depreciationConvention: 'DAILY' }));
  });

  it('keeps the convention fixed once the asset has been depreciated, and does not send it', () => {
    api['get'].mockReturnValue(of(asset({ depreciationConvention: 'MID_MONTH', accumulatedDepreciation: 2_000, depreciatedThrough: '2026-01-31' })));
    TestBed.overrideComponent(FixedAssetFormPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(FixedAssetFormPage);
    fixture.componentRef.setInput('id', 'fa-1');
    const page = fixture.componentInstance;
    page.ngOnInit();
    expect(page.form.controls.depreciationConvention.disabled).toBe(true);
    expect(page.form.controls.depreciationConvention.value).toBe('MID_MONTH');
    page.save();
    expect(api['update'].mock.calls[0][1]).not.toHaveProperty('depreciationConvention');
  });

  it('refuses an opening balance without the month it covers', () => {
    TestBed.overrideComponent(FixedAssetFormPage, { set: { template: '' } });
    const page = TestBed.createComponent(FixedAssetFormPage).componentInstance;
    page.ngOnInit();
    page.form.patchValue({
      name: 'Local',
      cost: 1_000,
      assetAccountId: 'a',
      accumulatedDepreciationAccountId: 'b',
      migrated: true,
      openingAccumulatedDepreciation: 200,
    });
    page.save();
    expect(api['create']).not.toHaveBeenCalled();
    expect(page.problems().map((problem) => problem.message)).toContain('fixed_assets.opening_through_required');
  });

  it('sends only the estimates when editing an asset already depreciated here', () => {
    api['get'].mockReturnValue(of(asset({ accumulatedDepreciation: 2_000, depreciatedThrough: '2026-01-31' })));
    TestBed.overrideComponent(FixedAssetFormPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(FixedAssetFormPage);
    fixture.componentRef.setInput('id', 'fa-1');
    const page = fixture.componentInstance;
    page.ngOnInit();
    expect(page.locked()).toBe(true);
    expect(page.form.controls.cost.disabled).toBe(true);

    page.form.patchValue({ usefulLifeMonths: 120 });
    page.save();
    const [, body] = api['update'].mock.calls[0];
    expect(body).toMatchObject({ usefulLifeMonths: 120 });
    expect(body).not.toHaveProperty('cost');
    expect(body).not.toHaveProperty('assetAccountId');
    expect(body).not.toHaveProperty('acquisitionDate');
  });

  it('works out the carrying amount on the day of disposal from the months still to charge', () => {
    const schedule: FixedAssetSchedule = {
      posted: [],
      projected: [
        { periodEnd: '2026-01-31', amount: 2_000, accumulatedAfter: 2_000, bookValueAfter: 118_000 },
        { periodEnd: '2026-02-28', amount: 2_000, accumulatedAfter: 4_000, bookValueAfter: 116_000 },
        { periodEnd: '2026-03-31', amount: 2_000, accumulatedAfter: 6_000, bookValueAfter: 114_000 },
      ],
    };
    expect(carryingOnDisposal(asset(), schedule, '2026-03-20')).toBe(116_000);
    expect(carryingOnDisposal(asset(), schedule, '2026-01-15')).toBe(120_000);
  });

  it('asks for the loss account when the sale falls short, and only sends the accounts the entry uses', () => {
    api['schedule'].mockReturnValue(of({ posted: [], projected: [{ periodEnd: '2026-01-31', amount: 2_000, accumulatedAfter: 2_000, bookValueAfter: 118_000 }] }));
    TestBed.overrideComponent(FixedAssetDisposePage, { set: { template: '' } });
    const fixture = TestBed.createComponent(FixedAssetDisposePage);
    fixture.componentRef.setInput('id', 'fa-1');
    const page = fixture.componentInstance;
    page.ngOnInit();
    page.form.patchValue({ disposalDate: '2026-02-10', salePrice: 100_000, disposalReason: 'Venta', cashAccountId: 'bank', gainOnDisposalAccountId: 'gain' });
    expect(page.outcome()).toEqual({ carrying: 118_000, price: 100_000, result: -18_000, catchUp: 1 });

    page.save();
    expect(api['dispose']).not.toHaveBeenCalled();
    expect(page.problems().map((problem) => problem.message)).toContain('fixed_assets.loss_account_required');

    page.form.patchValue({ lossOnDisposalAccountId: 'loss' });
    page.save();
    expect(api['dispose']).toHaveBeenCalledWith('fa-1', {
      disposalDate: '2026-02-10',
      salePrice: 100_000,
      disposalReason: 'Venta',
      cashAccountId: 'bank',
      lossOnDisposalAccountId: 'loss',
    });
  });

  it('previews the month that just ended and posts it after confirmation', async () => {
    TestBed.overrideComponent(DepreciationRunPage, { set: { template: '' } });
    const page = TestBed.createComponent(DepreciationRunPage).componentInstance;
    page.ngOnInit();
    expect(api['previewDepreciation']).toHaveBeenCalledWith(previousMonth());
    expect(page.rows()).toHaveLength(1);

    await page.run();
    expect(api['runDepreciation']).toHaveBeenCalledWith(previousMonth());
    expect(page.posted()?.journalEntryId).toBe('je-1');
    // What it posted is a run, and the summary leads to it.
    expect(page.posted()?.runId).toBe('run-1');
  });

  it('lists the runs, by what set them going', () => {
    const fixture = TestBed.createComponent(DepreciationRunsPage);
    const page = fixture.componentInstance;
    page.ngOnInit();
    expect(api['listRuns']).toHaveBeenCalledWith({ trigger: null, page: 1, pageSize: 50 });
    expect(page.rows()).toHaveLength(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Ana Pérez');

    page.setTrigger('DISPOSAL');
    expect(api['listRuns']).toHaveBeenLastCalledWith({ trigger: 'DISPOSAL', page: 1, pageSize: 50 });
    expect(depreciationRunTriggerKey('PERIOD_CLOSE')).toBe('fixed_assets.runs.trigger.period_close');
  });

  it('shows one run: each month it charged, and the entry that carries it', () => {
    const fixture = TestBed.createComponent(DepreciationRunDetailPage);
    fixture.componentRef.setInput('id', 'run-1');
    fixture.detectChanges();
    const page = fixture.componentInstance;
    expect(api['getRun']).toHaveBeenCalledWith('run-1');
    expect(page.run()?.charges).toHaveLength(2);
    expect(page.entryNumbers().get('je-3')).toBe('DEPREC-2026-000003');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('DEPREC-2026-000002');
    expect(text).toContain('Ana Pérez');
  });

  it('shows what a month still running would charge, and does not offer to post it', async () => {
    const blocked = { key: 'fixed_assets.depreciation_period_not_ended', params: { period: '2026-11', today: '2026-11-07' } };
    api['previewDepreciation'].mockReturnValue(
      of({ periodEnd: '2026-11-30', journalEntryId: null, total: 2_000, assets: [{ id: 'fa-1', number: 'AF-2026-000001', name: 'Camioneta', months: 1, amount: 2_000 }], skipped: [], tax: noTax, postable: false, notPostable: blocked }),
    );
    const fixture = TestBed.createComponent(DepreciationRunPage);
    const page = fixture.componentInstance;
    page.setPeriod('2026-11');
    fixture.detectChanges();

    expect(page.rows()).toHaveLength(1);
    expect(page.notPostable()).toEqual(blocked);
    expect(page.canPost()).toBe(false);
    const post = fixture.nativeElement.querySelector('button.primary-button') as HTMLButtonElement | null;
    expect(post).not.toBeNull();
    expect(post!.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('fixed_assets.depreciation_period_not_ended');

    await page.run();
    expect(api['runDepreciation']).not.toHaveBeenCalled();
  });

  it('offers to post a month that has ended', () => {
    const fixture = TestBed.createComponent(DepreciationRunPage);
    fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const post = fixture.nativeElement.querySelector('button.primary-button') as HTMLButtonElement | null;
    expect(post).not.toBeNull();
    expect(post!.disabled).toBe(false);
    expect(fixture.componentInstance.notPostable()).toBeNull();
  });

  it('runs for the month before today', () => {
    expect(previousMonth(new Date(2026, 0, 15))).toBe('2025-12');
    expect(previousMonth(new Date(2026, 6, 1))).toBe('2026-06');
  });
});
