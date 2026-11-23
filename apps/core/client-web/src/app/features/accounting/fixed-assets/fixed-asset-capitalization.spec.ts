import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { FixedAssetFormPage } from './fixed-asset-form.page';
import { FixedAssetCapitalizationPage } from './fixed-asset-capitalization.page';
import { FixedAssetReconciliationPage } from './fixed-asset-reconciliation.page';
import { capitalizationGroup, capitalizationOf, sourceKey } from './capitalization-fields.component';
import { CapitalizationSource, FixedAsset, FixedAssetsService, ReconciliationReport, UnlinkedAsset, UntracedPosting } from '../data/fixed-assets.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';
import { authServiceMock } from '../../../../testing/service-mocks';

/**
 * How an asset's cost entered the ledger, on screen (audit 2026-11-07, FINB-15): a new asset says
 * it — posted here or from a purchase already in the books —, a purchase waiting to be registered
 * opens the form on itself, an asset registered before the rule is linked afterwards, and the
 * reconciliation sets each account of the register against the ledger.
 */
describe('fixed-asset capitalization', () => {
  const source: CapitalizationSource = {
    kind: 'VENDOR_BILL',
    id: 'bill-1',
    journalEntryId: 'je-bill',
    entryNumber: 'COMPRAS-2026-000004',
    date: '2026-04-10',
    reference: 'QA-B-001',
    supplier: 'QA-Proveedor',
    accountId: 'acc-equipment',
    accountCode: '1504',
    accountName: { es: 'Equipos' },
    debited: 300_000,
    registered: 100_000,
    available: 200_000,
  };
  const asset = (overrides: Partial<FixedAsset> = {}): FixedAsset => ({
    id: 'fa-9',
    number: 'AF-2026-000009',
    name: 'QA-Antiguo',
    description: null,
    branchId: null,
    acquisitionDate: '2026-01-15',
    inServiceDate: '2026-01-15',
    cost: 7_000,
    residualValue: 0,
    usefulLifeMonths: 60,
    depreciationMethod: 'STRAIGHT_LINE',
    decliningAnnualRate: null,
    depreciationConvention: 'FULL_MONTH',
    categoryId: null,
    category: null,
    taxBook: null,
    capitalizationMethod: 'UNLINKED',
    capitalizationEntryId: null,
    capitalizationOffsetAccountId: null,
    bookValue: 7_000,
    accumulatedDepreciation: 0,
    openingAccumulatedDepreciation: 0,
    depreciatedThrough: null,
    status: 'IN_USE',
    assetAccountId: 'acc-equipment',
    accumulatedDepreciationAccountId: 'acc-accum',
    depreciationExpenseAccountId: null,
    vendorBillId: null,
    disposalDate: null,
    disposalProceeds: null,
    disposalReason: null,
    disposalJournalEntryId: null,
    createdAt: '2026-01-15T12:00:00.000Z',
    ...overrides,
  });
  const report: ReconciliationReport = {
    asOf: '2026-12-31',
    accounts: [
      { accountId: 'acc-equipment', code: '1504', name: { es: 'Equipos' }, role: 'COST', assets: 5, register: 407_000, ledger: 603_000, difference: 196_000, untraced: 203_000, unlinked: 7_000 },
      { accountId: 'acc-accum', code: '1591', name: { es: 'Depreciación acumulada' }, role: 'ACCUMULATED', assets: 5, register: 20_000, ledger: 20_000, difference: 0, untraced: 0, unlinked: 0 },
    ],
    totals: { register: 387_000, ledger: 583_000, difference: 196_000, untraced: 203_000, unlinked: 7_000 },
    counts: { unlinkedAssets: 2, untracedPostings: 1 },
  };
  const unlinkedRows: UnlinkedAsset[] = [
    { id: 'fa-9', number: 'AF-2026-000009', name: 'QA-Antiguo', accountId: 'acc-equipment', accumulatedAccountId: 'acc-accum', cost: 7_000, openingAccumulated: 0, reason: 'NEVER_LINKED', entryId: null, entryNumber: null, entryDate: null, disposalDate: null },
    { id: 'fa-3', number: 'AF-2026-000003', name: 'QA-Prensa', accountId: 'acc-equipment', accumulatedAccountId: 'acc-accum', cost: 100_000, openingAccumulated: 0, reason: 'SOURCE_LATER', entryId: 'je-bill', entryNumber: 'COMPRAS-2026-000004', entryDate: '2026-04-10', disposalDate: null },
  ];
  const untracedRows: UntracedPosting[] = [{ entryId: 'je-stray', entryNumber: 'GENERAL-2026-000003', date: '2026-05-20', description: 'QA', accountId: 'acc-equipment', amount: 3_000 }];

  let api: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;

  beforeEach(() => {
    api = {
      get: jest.fn().mockReturnValue(of(asset())),
      create: jest.fn().mockReturnValue(of(asset({ capitalizationMethod: 'VENDOR_BILL', vendorBillId: 'bill-1' }))),
      update: jest.fn(),
      capitalize: jest.fn().mockReturnValue(of(asset({ capitalizationMethod: 'POSTED' }))),
      capitalizationSources: jest.fn().mockReturnValue(of({ rows: [source], page: 1, pageSize: 50, total: 1, hasMore: false })),
      reconciliation: jest.fn().mockReturnValue(of(report)),
      unlinkedAssets: jest.fn().mockReturnValue(of({ rows: unlinkedRows, page: 1, pageSize: 50, total: 2, hasMore: false })),
      untracedPostings: jest.fn().mockReturnValue(of({ rows: untracedRows, page: 1, pageSize: 50, total: 1, hasMore: false })),
      listCategories: jest.fn().mockReturnValue(of([])),
      taxCategories: jest.fn().mockReturnValue(of(null)),
    };
    notifications = { httpErrorMessage: jest.fn().mockReturnValue('x'), showHttpError: jest.fn(), showSuccess: jest.fn(), showError: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: FixedAssetsService, useValue: api },
        { provide: NotificationService, useValue: notifications },
        { provide: DialogService, useValue: { confirm: jest.fn().mockResolvedValue(true) } },
        { provide: ChartOfAccountsApiService, useValue: { searchAccounts: () => of([]), getAccountById: (id: string) => of({ id, code: '1', name: 'x' }) } },
        { provide: BranchesService, useValue: { hasBranches: () => false, branches: () => [], mine: () => ({ branches: [], defaultBranchId: null }), ensureMine: () => Promise.resolve(), load: jest.fn() } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
        { provide: AuthService, useValue: authServiceMock({ permissions: ['fixed_assets:manage', 'fixed_assets:view'] }) },
      ],
    });
  });

  it('says what a posting needs and what a link needs, and builds what the server reads', () => {
    expect(capitalizationOf({ mode: 'POSTED', offsetAccountId: null })).toEqual({ problem: 'fixed_assets.capitalization_offset_required' });
    expect(capitalizationOf({ mode: 'POSTED', offsetAccountId: 'acc-equity', date: '2026-01-01' })).toEqual({
      input: { method: 'POSTED', offsetAccountId: 'acc-equity', date: '2026-01-01' },
    });
    expect(capitalizationOf({ mode: 'SOURCE', source: null })).toEqual({ problem: 'fixed_assets.capitalization.source_required' });
    expect(capitalizationOf({ mode: 'SOURCE', source: sourceKey(source) })).toEqual({ input: { method: 'VENDOR_BILL', vendorBillId: 'bill-1' } });
    expect(capitalizationOf({ mode: 'SOURCE', source: 'JOURNAL_ENTRY|je-1|acc-equipment' })).toEqual({ input: { method: 'JOURNAL_ENTRY', journalEntryId: 'je-1' } });
    expect(capitalizationGroup(new FormBuilder()).getRawValue()).toEqual({ mode: 'POSTED', offsetAccountId: null, date: '', source: null });
  });

  it('refuses to register an asset without saying how its cost entered the ledger', () => {
    TestBed.overrideComponent(FixedAssetFormPage, { set: { template: '' } });
    const page = TestBed.createComponent(FixedAssetFormPage).componentInstance;
    page.ngOnInit();
    page.form.patchValue({ name: 'QA-Torno', acquisitionDate: '2026-03-05', cost: 150_000, usefulLifeMonths: 60, assetAccountId: 'acc-equipment', accumulatedDepreciationAccountId: 'acc-accum' });
    page.save();
    expect(api['create']).not.toHaveBeenCalled();
    expect(page.problems().map((problem) => problem.message)).toEqual(['fixed_assets.capitalization_offset_required']);
  });

  it('opens on a purchase waiting to be registered: its account, amount and date, and registers the asset from it', () => {
    TestBed.overrideComponent(FixedAssetFormPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(FixedAssetFormPage);
    fixture.componentRef.setInput('sourceKind', 'VENDOR_BILL');
    fixture.componentRef.setInput('sourceId', 'bill-1');
    fixture.componentRef.setInput('sourceAccountId', 'acc-equipment');
    fixture.componentRef.setInput('cost', '200000');
    fixture.componentRef.setInput('date', '2026-04-10');
    fixture.componentRef.setInput('name', 'QA-Prensa');
    const page = fixture.componentInstance;
    page.ngOnInit();
    expect(page.form.getRawValue()).toMatchObject({ name: 'QA-Prensa', assetAccountId: 'acc-equipment', cost: 200_000, acquisitionDate: '2026-04-10' });
    expect(page.form.controls.capitalization.getRawValue()).toMatchObject({ mode: 'SOURCE', source: 'VENDOR_BILL|bill-1|acc-equipment' });

    page.form.patchValue({ accumulatedDepreciationAccountId: 'acc-accum', usefulLifeMonths: 120 });
    page.save();
    expect(api['create']).toHaveBeenCalledWith(expect.objectContaining({ cost: 200_000, capitalization: { method: 'VENDOR_BILL', vendorBillId: 'bill-1' } }));
  });

  it('links an asset registered before the rule afterwards, posting its acquisition', () => {
    TestBed.overrideComponent(FixedAssetCapitalizationPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(FixedAssetCapitalizationPage);
    fixture.componentRef.setInput('id', 'fa-9');
    const page = fixture.componentInstance;
    page.ngOnInit();
    expect(page.asset()?.capitalizationMethod).toBe('UNLINKED');
    page.form.controls.capitalization.patchValue({ mode: 'POSTED', offsetAccountId: 'acc-bank' });
    page.save();
    expect(api['capitalize']).toHaveBeenCalledWith('fa-9', { method: 'POSTED', offsetAccountId: 'acc-bank' });
    expect(notifications['showSuccess']).toHaveBeenCalledWith('fixed_assets.capitalization.saved', { number: 'AF-2026-000009' });
  });

  it('opens a link on the purchase it points to', () => {
    api['get'].mockReturnValue(of(asset({ capitalizationMethod: 'VENDOR_BILL', vendorBillId: 'bill-1' })));
    TestBed.overrideComponent(FixedAssetCapitalizationPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(FixedAssetCapitalizationPage);
    fixture.componentRef.setInput('id', 'fa-9');
    fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.form.controls.capitalization.getRawValue()).toMatchObject({ mode: 'SOURCE', source: 'VENDOR_BILL|bill-1|acc-equipment' });
  });

  it('sets each account of the register against the ledger, says why each asset has no cost there, and offers to register what is waiting', () => {
    TestBed.overrideComponent(FixedAssetReconciliationPage, { set: { template: '' } });
    const page = TestBed.createComponent(FixedAssetReconciliationPage).componentInstance;
    page.ngOnInit();
    expect(api['reconciliation']).toHaveBeenCalledWith(page.asOf());
    expect(api['unlinkedAssets']).toHaveBeenCalledWith(page.asOf(), 1, 50);
    expect(api['untracedPostings']).toHaveBeenCalledWith(page.asOf(), 1, 50);
    expect(page.accounts()).toHaveLength(2);
    expect(page.reconciled()).toBe(false);
    expect(page.codeOf('acc-equipment')).toBe('1504');
    expect(page.codeOf(null)).toBe('');
    expect(page.unlinked()?.rows.map((row) => row.reason)).toEqual(['NEVER_LINKED', 'SOURCE_LATER']);
    // A bill posted after the day explains itself with time; a never-linked asset is linked.
    expect(page.correctable(unlinkedRows[0])).toBe(true);
    expect(page.correctable(unlinkedRows[1])).toBe(false);
    expect(page.reasonParams(unlinkedRows[1])).toEqual({ entry: 'COMPRAS-2026-000004', date: expect.stringContaining('2026') });
    expect(page.untraced()?.rows).toEqual(untracedRows);
    expect(page.waiting()).toEqual([source]);
    expect(page.registerParams(source)).toEqual({
      sourceKind: 'VENDOR_BILL',
      sourceId: 'bill-1',
      sourceAccountId: 'acc-equipment',
      cost: '200000',
      date: '2026-04-10',
      name: 'QA-B-001',
    });

    // Each list moves through its own pages; a new day starts both again.
    page.goToUnlinkedPage(2);
    expect(api['unlinkedAssets']).toHaveBeenLastCalledWith(page.asOf(), 2, 50);
    page.goToUntracedPage(3);
    expect(api['untracedPostings']).toHaveBeenLastCalledWith(page.asOf(), 3, 50);
    page.setAsOf('2026-02-28');
    expect(api['reconciliation']).toHaveBeenLastCalledWith('2026-02-28');
    expect(api['unlinkedAssets']).toHaveBeenLastCalledWith('2026-02-28', 1, 50);
    expect(page.unlinkedPage()).toBe(1);
    expect(page.untracedPage()).toBe(1);
  });

  it('opens on the day the close asks about', () => {
    TestBed.overrideComponent(FixedAssetReconciliationPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(FixedAssetReconciliationPage);
    fixture.componentRef.setInput('asOf', '2026-03-31');
    fixture.componentInstance.ngOnInit();
    expect(api['reconciliation']).toHaveBeenCalledWith('2026-03-31');
    expect(api['untracedPostings']).toHaveBeenCalledWith('2026-03-31', 1, 50);
  });

  it('says the register and the ledger agree only when nothing on either side is unexplained', () => {
    const agreed: ReconciliationReport = {
      ...report,
      accounts: report.accounts.map((row) => ({ ...row, ledger: row.register, difference: 0, untraced: 0, unlinked: 0 })),
    };
    // The difference alone can be zero by chance: 20 000 untraced against 20 000 unlinked.
    const byChance: ReconciliationReport = {
      ...report,
      accounts: report.accounts.map((row) => ({ ...row, difference: 0, untraced: 20_000, unlinked: 20_000 })),
    };
    TestBed.overrideComponent(FixedAssetReconciliationPage, { set: { template: '' } });
    api['reconciliation'].mockReturnValueOnce(of(agreed));
    const page = TestBed.createComponent(FixedAssetReconciliationPage).componentInstance;
    page.ngOnInit();
    expect(page.reconciled()).toBe(true);
    api['reconciliation'].mockReturnValueOnce(of(byChance));
    page.load();
    expect(page.reconciled()).toBe(false);
  });
});
