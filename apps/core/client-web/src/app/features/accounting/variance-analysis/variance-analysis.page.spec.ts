import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { VarianceAnalysisPage } from './variance-analysis.page';
import { BudgetsService, isFavourable } from '../data/budgets.service';
import { NotificationService } from '../../../core/services/notification';

describe('VarianceAnalysisPage', () => {
  const report = {
    period: { startDate: '2026-03-01', endDate: '2026-04-30' },
    ledger: { id: 'l', name: 'Principal', currency: 'DOP' },
    lines: [
      {
        accountId: 'a',
        accountCode: '6101',
        accountName: { es: 'Alquiler' },
        accountType: 'EXPENSE',
        dimensions: {},
        budgetedAmount: 2000,
        actualAmount: 1300,
        difference: 700,
        consumedRatio: 0.65,
        unbudgetedActual: 450,
        months: {
          '2026-02': { budgeted: null, actual: 450 },
          '2026-03': { budgeted: 1000, actual: 400 },
          '2026-04': { budgeted: 1000, actual: 900 },
        },
      },
    ],
    totals: { budgeted: 2000, actual: 1300, difference: 700, unbudgetedActual: 450 },
  };

  it('reads the range from the URL and asks the server for it', () => {
    const variance = jest.fn().mockReturnValue(of(report));
    TestBed.configureTestingModule({
      imports: [VarianceAnalysisPage],
      providers: [
        provideRouter([]),
        { provide: BudgetsService, useValue: { variance } },
        { provide: NotificationService, useValue: { httpErrorMessage: () => 'x' } },
      ],
    });
    const fixture = TestBed.createComponent(VarianceAnalysisPage);
    fixture.componentRef.setInput('from', '2026-03');
    fixture.componentRef.setInput('to', '2026-04');
    fixture.detectChanges();
    expect(variance).toHaveBeenCalledWith('2026-03', '2026-04');
    expect(fixture.componentInstance.lines()).toHaveLength(1);
    expect(fixture.componentInstance.currency()).toBe('DOP');
  });

  /**
   * FINB-21: what was posted in months with no budget is not mixed into the comparison, and not
   * hidden either — it has its own column, and its own total.
   */
  it('shows the spending outside the budgeted months in a column of its own', () => {
    TestBed.configureTestingModule({
      imports: [VarianceAnalysisPage],
      providers: [
        provideRouter([]),
        { provide: BudgetsService, useValue: { variance: jest.fn().mockReturnValue(of(report)) } },
        { provide: NotificationService, useValue: { httpErrorMessage: () => 'x' } },
      ],
    });
    const fixture = TestBed.createComponent(VarianceAnalysisPage);
    fixture.componentRef.setInput('from', '2026-02');
    fixture.componentRef.setInput('to', '2026-04');
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('thead')?.textContent).toContain('budgets.variance.outside_budget');
    const cells = [...element.querySelectorAll('tbody tr td')].map((cell) => cell.textContent?.trim());
    expect(cells.at(-1)).toContain('450');
    expect(element.querySelector('tfoot')?.textContent).toContain('450');
  });

  it('judges a difference by the account type, not its name', () => {
    expect(isFavourable({ accountType: 'EXPENSE', difference: 100 })).toBe(true);
    expect(isFavourable({ accountType: 'EXPENSE', difference: -100 })).toBe(false);
    expect(isFavourable({ accountType: 'REVENUE', difference: -100 })).toBe(true);
    expect(isFavourable({ accountType: 'REVENUE', difference: 100 })).toBe(false);
  });
});
