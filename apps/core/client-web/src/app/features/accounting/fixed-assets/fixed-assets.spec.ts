import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { FixedAssetsPage } from './fixed-assets.page';
import { FixedAssetFormPage } from './fixed-asset-form.page';
import { FixedAssetDisposePage, carryingOnDisposal } from './fixed-asset-dispose.page';
import { DepreciationRunPage, previousMonth } from './depreciation-run.page';
import { FixedAsset, FixedAssetSchedule, FixedAssetsService, hasBeenDepreciated } from '../data/fixed-assets.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';

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
        of({ periodEnd: '2026-03-31', journalEntryId: null, total: 6_000, assets: [{ id: 'fa-1', number: 'AF-2026-000001', name: 'Camioneta', months: 3, amount: 6_000 }], skipped: [] }),
      ),
      runDepreciation: jest.fn().mockReturnValue(
        of({ periodEnd: '2026-03-31', journalEntryId: 'je-1', total: 6_000, assets: [{ id: 'fa-1', number: 'AF-2026-000001', name: 'Camioneta', months: 3, amount: 6_000 }], skipped: [] }),
      ),
    };
    notifications = {
      httpErrorMessage: jest.fn().mockReturnValue('x'),
      showHttpError: jest.fn(),
      showSuccess: jest.fn(),
      showError: jest.fn(),
    };
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: FixedAssetsService, useValue: api },
        { provide: NotificationService, useValue: notifications },
        { provide: DialogService, useValue: { confirm: jest.fn().mockResolvedValue(true), prompt: jest.fn() } },
        { provide: ChartOfAccountsApiService, useValue: { searchAccounts: () => of([]), getAccountById: (id: string) => of({ id, code: '1', name: 'x' }) } },
        { provide: BranchesService, useValue: { hasBranches: () => false, branches: () => [], load: jest.fn() } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
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
  });

  it('runs for the month before today', () => {
    expect(previousMonth(new Date(2026, 0, 15))).toBe('2025-12');
    expect(previousMonth(new Date(2026, 6, 1))).toBe('2026-06');
  });
});
