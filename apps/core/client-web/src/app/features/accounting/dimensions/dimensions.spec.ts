import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { of } from 'rxjs';
import { DimensionsPage, validate } from './dimensions.page';
import { VxDimensionFilterComponent } from './dimension-filter.component';
import { Dimension, DimensionsService, valueLabel, valueTree } from '../data/dimensions.service';
import { JournalEntryFormPage } from '../journal-entry-form/journal-entry-form.page';
import { FinancialReportingService } from '../../reports/data/financial-reporting.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/services/auth';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { LedgersService } from '../../../core/api/ledgers.service';
import { JournalsService } from '../../../core/api/journals.service';

describe('analytic dimensions', () => {
  const costCentre: Dimension = {
    id: 'd-1',
    name: 'Centro de Costo',
    description: null,
    isActive: true,
    inUse: true,
    values: [
      { id: 'v-1', value: 'VENTAS', name: 'Ventas', isActive: true, parent: null, inUse: true },
      { id: 'v-2', value: 'TIENDA1', name: 'Tienda 1', isActive: true, parent: 'VENTAS', inUse: false },
      { id: 'v-3', value: 'ADMIN', name: null, isActive: false, parent: null, inUse: true },
    ],
  };

  it('orders values as a tree, each followed by the ones that roll up into it', () => {
    expect(valueTree(costCentre.values).map((row) => [row.value.value, row.depth])).toEqual([
      ['ADMIN', 0],
      ['VENTAS', 0],
      ['TIENDA1', 1],
    ]);
    expect(valueLabel(costCentre.values[0])).toBe('VENTAS · Ventas');
    expect(valueLabel(costCentre.values[2])).toBe('ADMIN');
  });

  it('says what the server would refuse before the round trip', () => {
    const draft = { id: null, name: 'Proyecto', description: '', isActive: true, inUse: false, values: [] as Dimension['values'] };
    expect(validate({ ...draft, name: '' })).toBe('dimensions.page.name_required');
    expect(validate({ ...draft, name: 'Región' })).toBe('validation.constraints.dimension_name');
    expect(validate({ ...draft, values: [{ value: '', name: null, isActive: true, parent: null }] })).toBe('dimensions.page.code_required');
    expect(
      validate({
        ...draft,
        values: [
          { value: 'P1', name: null, isActive: true, parent: null },
          { value: 'P1', name: null, isActive: true, parent: null },
        ],
      }),
    ).toBe('dimensions.page.code_duplicated');
    expect(validate({ ...draft, values: [{ value: '-X', name: null, isActive: true, parent: null }] })).toBe('dimensions.page.code_invalid');
    expect(validate({ ...draft, values: [{ value: 'OBRA-12', name: 'Obra 12', isActive: true, parent: null }] })).toBeNull();
  });

  describe('the dimensions page', () => {
    let api: Record<string, jest.Mock>;

    beforeEach(() => {
      api = {
        list: jest.fn().mockReturnValue(of([costCentre])),
        rules: jest.fn().mockReturnValue(of([])),
        create: jest.fn(),
        update: jest.fn().mockReturnValue(of(costCentre)),
        invalidate: jest.fn(),
      };
      TestBed.configureTestingModule({
        imports: [DimensionsPage, TranslateModule.forRoot()],
        providers: [
          { provide: DimensionsService, useValue: api },
          { provide: NotificationService, useValue: { httpErrorMessage: () => 'x', showSuccess: jest.fn(), showHttpError: jest.fn() } },
          { provide: DialogService, useValue: { confirm: jest.fn() } },
          { provide: AuthService, useValue: { hasPermissions: () => true } },
          { provide: ChartOfAccountsApiService, useValue: { searchAccounts: () => of([]), getAccountById: () => of(null) } },
        ],
      });
      TestBed.overrideComponent(DimensionsPage, { set: { template: '' } });
    });

    it('never offers a value, or its descendants, as its own parent', () => {
      const page = TestBed.createComponent(DimensionsPage).componentInstance;
      page.ngOnInit();
      page.select(costCentre);
      const ventas = page.draft()!.values[0];
      expect(page.parentOptions(ventas).map((value) => value.value)).toEqual(['ADMIN']);
    });

    it('carries the children when a code is renamed, and saves the whole list', () => {
      const page = TestBed.createComponent(DimensionsPage).componentInstance;
      page.ngOnInit();
      page.select({ ...costCentre, inUse: false, values: costCentre.values.map((value) => ({ ...value, inUse: false })) });
      page.patchValue(0, { value: 'COMERCIAL' });
      expect(page.draft()!.values[1].parent).toBe('COMERCIAL');

      page.save();
      expect(api['update']).toHaveBeenCalledWith('d-1', expect.objectContaining({
        name: 'Centro de Costo',
        values: [
          { id: 'v-1', value: 'COMERCIAL', name: 'Ventas', isActive: true, parent: null },
          { id: 'v-2', value: 'TIENDA1', name: 'Tienda 1', isActive: true, parent: 'COMERCIAL' },
          { id: 'v-3', value: 'ADMIN', name: null, isActive: false, parent: null },
        ],
      }));
      expect(api['invalidate']).toHaveBeenCalled();
    });
  });

  describe('tagging journal lines', () => {
    function form() {
      TestBed.configureTestingModule({
        imports: [JournalEntryFormPage, TranslateModule.forRoot()],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          {
            provide: DimensionsService,
            useValue: {
              forTagging: () => of([costCentre]),
              rules: () => of([{ accountId: 'acc-6101', accountCode: '6101', accountName: 'Gastos', dimensionId: 'd-1', dimensionName: 'Centro de Costo', isRequired: true }]),
            },
          },
          { provide: LedgersService, useValue: { getLedgers: () => of([]) } },
          { provide: JournalsService, useValue: { getJournals: () => of([]) } },
          { provide: NotificationService, useValue: { showError: jest.fn(), showSuccess: jest.fn(), showHttpError: jest.fn() } },
        ],
      });
      TestBed.overrideComponent(JournalEntryFormPage, { set: { template: '' } });
      const page = TestBed.createComponent(JournalEntryFormPage).componentInstance;
      page.ngOnInit();
      return page;
    }

    it('offers the active values only, and opens the tagging row because an account requires one', () => {
      const page = form();
      expect(page.tagDimensions()[0].values.map((value) => value.value)).toEqual(['VENTAS', 'TIENDA1']);
      expect(page.showDimensions()).toBe(true);
    });

    it('stores a tag on the line and refuses to save a line its account requires one on', () => {
      const page = form();
      page.lines.at(0).patchValue({ accountId: 'acc-6101', debit: 100 });
      page.lines.at(1).patchValue({ accountId: 'acc-1101', credit: 100 });
      page.entryForm.patchValue({ ledgerId: 'l', journalId: 'j', description: 'Gasto' });

      expect(page.missingTags()).toEqual([{ line: 1, dimension: 'Centro de Costo' }]);
      page.saveEntry();
      expect(page.problems()[0]).toMatchObject({ message: 'accounting.journal_entry_form.dimension_required' });

      page.setLineTag(0, 'Centro de Costo', 'TIENDA1');
      expect(page.lines.at(0).get('dimensions')?.value).toEqual({ 'Centro de Costo': 'TIENDA1' });
      expect(page.missingTags()).toEqual([]);
      page.setLineTag(0, 'Centro de Costo', '');
      expect(page.lines.at(0).get('dimensions')?.value).toEqual({});
    });

    it('still shows a value an old line carries after it was retired', () => {
      const page = form();
      page.lines.at(0).patchValue({ dimensions: { 'Centro de Costo': 'ADMIN' } });
      expect(page.tagOptions(0, page.tagDimensions()[0]).map((row) => row.value.value)).toContain('ADMIN');
    });
  });

  it('filters a statement by dimension with the parameter the API reads', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const reports = TestBed.inject(FinancialReportingService);
    const http = TestBed.inject(HttpTestingController);
    reports.incomeStatement('2026-01-01', '2026-01-31', { dimensions: { 'Centro de Costo': 'VENTAS' } }).subscribe();
    const request = http.expectOne((candidate) => candidate.url.endsWith('/income-statement'));
    expect(request.request.params.getAll('dimension')).toEqual(['Centro de Costo=VENTAS']);
    expect(request.request.params.get('startDate')).toBe('2026-01-01');
    http.verify();
  });

  it('emits a filter only once a value is chosen, and clears it with the dimension', () => {
    TestBed.configureTestingModule({
      imports: [VxDimensionFilterComponent, TranslateModule.forRoot()],
      providers: [{ provide: DimensionsService, useValue: { forTagging: () => of([costCentre]) } }],
    });
    const filter = TestBed.createComponent(VxDimensionFilterComponent).componentInstance;
    filter.ngOnInit();
    const emitted: Array<Record<string, string>> = [];
    filter.filterChange.subscribe((value) => emitted.push(value));

    filter.chooseDimension('Centro de Costo');
    expect(emitted).toEqual([]);
    // Retired values stay pickable: the history a report reads still carries them.
    expect(filter.values().map((row) => row.value.value)).toContain('ADMIN');
    filter.chooseValue('VENTAS');
    filter.chooseDimension('');
    expect(emitted).toEqual([{ 'Centro de Costo': 'VENTAS' }, {}]);
    expect(filter.values()).toEqual([]);
  });
});
