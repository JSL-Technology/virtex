import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { BudgetFormPage, restOfYear } from './budget-form.page';
import { BudgetsService } from '../data/budgets.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';

describe('BudgetFormPage', () => {
  const saved = { id: 'b-1', name: 'Operativo', period: '2026-03', version: 1, lines: [{ accountId: 'a-1', amount: 1000 }] };
  let budgets: Record<string, jest.Mock>;

  function create(id?: string) {
    budgets = {
      get: jest.fn().mockReturnValue(of(saved)),
      create: jest.fn().mockReturnValue(of(saved)),
      update: jest.fn().mockReturnValue(of(saved)),
      copy: jest.fn().mockReturnValue(of([{ id: 'x', period: '2026-04' }])),
      vsActual: jest.fn().mockReturnValue(of({ period: { startDate: '', endDate: '' }, ledger: null, lines: [], totals: { budgeted: 0, actual: 0, difference: 0 } })),
    };
    TestBed.configureTestingModule({
      imports: [BudgetFormPage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: BudgetsService, useValue: budgets },
        { provide: ChartOfAccountsApiService, useValue: { searchAccounts: () => of([]), getAccountById: (accountId: string) => of({ id: accountId, code: '6101', name: { es: 'Alquiler' } }) } },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showHttpError: jest.fn() } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
        { provide: AuthService, useValue: { isAuthenticated$: of(true), getPermissions$: () => of(['budgets:manage']), hasPermissions: () => true } },
      ],
    });
    const fixture = TestBed.createComponent(BudgetFormPage);
    if (id) fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('offers the rest of the year as copy targets', () => {
    expect(restOfYear('2026-10')).toEqual(['2026-11', '2026-12']);
    expect(restOfYear('2026-12')).toEqual([]);
  });

  it('refuses the same account twice and sends nothing', () => {
    const page = create();
    page.form.patchValue({ name: 'Operativo', period: '2026-03' });
    page.lines.at(0).patchValue({ accountId: 'a-1', amount: 100 });
    page.addLine();
    page.lines.at(1).patchValue({ accountId: 'a-1', amount: 200 });
    page.save();
    expect(budgets['create']).not.toHaveBeenCalled();
    expect(page.problems().map((p) => p.message)).toContain('budgets.form.repeated_account');
  });

  it('creates the month with its lines rounded to cents', () => {
    const page = create();
    page.form.patchValue({ name: ' Operativo ', period: '2026-03' });
    page.lines.at(0).patchValue({ accountId: 'a-1', amount: 1000.004 });
    page.save();
    expect(budgets['create']).toHaveBeenCalledWith({ name: 'Operativo', period: '2026-03', lines: [{ accountId: 'a-1', amount: 1000 }] });
  });

  it('opens a saved budget with its actuals and copies it forward', () => {
    const page = create('b-1');
    expect(budgets['vsActual']).toHaveBeenCalledWith('b-1');
    expect(page.lines.length).toBe(1);
    page.toggleCopyPeriod('2026-04', true);
    page.copyFactor.set(1.05);
    page.copy();
    expect(budgets['copy']).toHaveBeenCalledWith('b-1', ['2026-04'], 1.05);
  });
});
