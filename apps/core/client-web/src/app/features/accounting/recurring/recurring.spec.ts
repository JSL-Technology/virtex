import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { of } from 'rxjs';
import { RecurringEntryFormPage, lineTotals } from './recurring-entry-form.page';
import { EntryTemplateFormPage, templateProblem } from '../entry-templates/entry-template-form.page';
import { RecurringEntriesService, allocateTemplate } from '../data/recurring-entries.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { AccountingService } from '../../../core/api/accounting.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { JournalsService } from '../../../core/api/journals.service';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { DimensionsService } from '../data/dimensions.service';

describe('recurring entries and templates', () => {
  let api: Record<string, jest.Mock>;

  beforeEach(() => {
    api = {
      get: jest.fn(),
      postedEntries: jest.fn().mockReturnValue(of([])),
      create: jest.fn().mockReturnValue(of({ id: 'r-1', description: 'Alquiler' })),
      update: jest.fn(),
      template: jest.fn(),
      createTemplate: jest.fn().mockReturnValue(of({ id: 't-1', name: 'Alquiler', description: 'x', lines: [] })),
      useTemplate: jest.fn().mockReturnValue(of({ id: 'je-1', entryNumber: 'GEN-2026-000001' })),
    };
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: RecurringEntriesService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn(), showSuccess: jest.fn(), showError: jest.fn() } },
        { provide: DialogService, useValue: { confirm: jest.fn() } },
        { provide: AccountingService, useValue: { searchAccounts: () => of([]) } },
        { provide: ChartOfAccountsApiService, useValue: { getAccountById: () => of(null) } },
        { provide: JournalsService, useValue: { getJournals: () => of([{ id: 'j-1', code: 'GENERAL', name: 'General' }]) } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
        { provide: DimensionsService, useValue: { forTagging: () => of([]) } },
      ],
    });
  });

  it('totals the lines to the cent and says whether they balance', () => {
    expect(lineTotals([{ accountId: 'a', debit: 0.1, credit: 0 }, { accountId: 'b', debit: 0.2, credit: 0 }, { accountId: 'c', debit: 0, credit: 0.3 }])).toEqual({
      debit: 0.3,
      credit: 0.3,
      balanced: true,
    });
    expect(lineTotals([{ accountId: 'a', debit: 0, credit: 0 }, { accountId: 'b', debit: 0, credit: 0 }]).balanced).toBe(false);
  });

  it('saves a balanced recurring entry with the journal it defaults to', () => {
    TestBed.overrideComponent(RecurringEntryFormPage, { set: { template: '' } });
    const page = TestBed.createComponent(RecurringEntryFormPage).componentInstance;
    page.ngOnInit();
    expect(page.form.controls.journalId.value).toBe('j-1');

    page.form.patchValue({ description: 'Alquiler', startDate: '2026-03-01' });
    page.patchLine(0, { accountId: 'rent', debit: 30_000 });
    page.patchLine(1, { accountId: 'bank', credit: 29_000 });
    page.save();
    expect(api['create']).not.toHaveBeenCalled();

    page.patchLine(1, { credit: 30_000 });
    page.save();
    expect(api['create']).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Alquiler',
        journalId: 'j-1',
        frequency: 'MONTHLY',
        lines: [
          { accountId: 'rent', description: undefined, debit: 30_000, credit: 0, dimensions: undefined },
          { accountId: 'bank', description: undefined, debit: 0, credit: 30_000, dimensions: undefined },
        ],
      }),
    );
  });

  it('refuses a template whose sides cannot be filled', () => {
    expect(templateProblem([{ accountId: 'a', type: 'DEBIT' }, { accountId: 'b', type: 'DEBIT' }])).toEqual({
      message: 'journal_entries.template_needs_both_sides',
    });
    expect(
      templateProblem([
        { accountId: 'a', type: 'DEBIT', percentage: 60 },
        { accountId: 'b', type: 'DEBIT' },
        { accountId: 'c', type: 'CREDIT' },
      ]),
    ).toMatchObject({ message: 'journal_entries.template_percentages_all_or_none' });
    expect(
      templateProblem([
        { accountId: 'a', type: 'DEBIT', percentage: 60 },
        { accountId: 'b', type: 'DEBIT', percentage: 40 },
        { accountId: 'c', type: 'CREDIT' },
      ]),
    ).toBeNull();
  });

  it('previews and posts an entry from a saved template', () => {
    api['template'].mockReturnValue(
      of({
        id: 't-1',
        name: 'Alquiler',
        description: 'Alquiler del local',
        lines: [
          { accountId: 'a', type: 'DEBIT', percentage: 60 },
          { accountId: 'b', type: 'DEBIT', percentage: 40 },
          { accountId: 'c', type: 'CREDIT' },
        ],
      }),
    );
    TestBed.overrideComponent(EntryTemplateFormPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(EntryTemplateFormPage);
    fixture.componentRef.setInput('id', 't-1');
    const page = fixture.componentInstance;
    page.ngOnInit();
    page.useAmount.set(1_000.01);
    expect(page.preview().map((row) => row.amount)).toEqual([600.01, 400, 1_000.01]);

    page.post();
    expect(api['useTemplate']).toHaveBeenCalledWith('t-1', expect.objectContaining({ amount: 1_000.01, journalId: 'j-1', description: 'Alquiler del local' }));
    expect(page.lastPosted()?.id).toBe('je-1');
  });

  it('allocates like the server: equal shares, the last line taking the rounding', () => {
    expect(allocateTemplate([{ accountId: 'a', type: 'DEBIT' }, { accountId: 'b', type: 'CREDIT' }, { accountId: 'c', type: 'CREDIT' }, { accountId: 'd', type: 'CREDIT' }], 100)).toEqual([
      100, 33.33, 33.33, 33.34,
    ]);
  });
});
