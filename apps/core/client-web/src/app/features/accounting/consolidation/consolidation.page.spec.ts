import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ConsolidationPage } from './consolidation.page';
import { ConsolidationApiService, ConsolidatedStatements } from './consolidation.service';
import { NotificationService } from '../../../core/services/notification';

/** FINB-33: the consolidation engine had no screen. */
describe('ConsolidationPage', () => {
  const statements = {
    consolidationDate: '2026-11-08T00:00:00Z',
    period: { startDate: '2026-01-01', endDate: '2026-12-31' },
    presentationCurrency: 'USD',
    parentOrganization: { id: 'p', legalName: 'Matriz' },
    entities: [],
    balanceSheet: {
      assets: [{ accountId: 'a', code: '1101', name: 'Efectivo', type: 'ASSET', amount: 100, contributions: [] }],
      liabilities: [],
      equity: [{ accountId: 'CONS-NCI', code: 'CONS-NCI', name: 'NCI', type: 'EQUITY', amount: 100, contributions: [] }],
      goodwill: 0,
      totalAssets: 100,
      totalLiabilities: 0,
      totalEquity: 100,
      equityAttributableToParent: 0,
      nonControllingInterests: 100,
      accumulatedTranslationAdjustment: 0,
      isBalanced: true,
      outOfBalanceBy: 0,
    },
    incomeStatement: { revenue: [], expenses: [], totalRevenue: 0, totalExpenses: 0, netIncome: 0, attributableToParent: 0, attributableToNonControlling: 0 },
    eliminations: [
      {
        kind: 'INVESTMENT_IN_SUBSIDIARY',
        description: 'Inversión en Filial',
        amount: 12000,
        organizationIds: [],
        entries: [{ side: 'CREDIT', code: '1601', label: 'Inversión', amount: 12000 }],
      },
    ],
    warnings: [{ code: 'INTRAGROUP_MISMATCH', organizationId: 'p', detail: 'Concilia los saldos' }],
  } as ConsolidatedStatements;
  const api = {
    run: jest.fn(() => of({ ...statements, runId: 'run-1' })),
    runs: jest.fn(() => of([])),
    run$: jest.fn(() => of({ id: 'run-1', result: statements })),
  };

  const build = () => {
    TestBed.configureTestingModule({
      imports: [ConsolidationPage],
      providers: [
        provideRouter([]),
        { provide: ConsolidationApiService, useValue: api },
        { provide: NotificationService, useValue: { showError: jest.fn(), showHttpError: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(ConsolidationPage);
    fixture.detectChanges();
    return fixture;
  };

  it('runs the consolidation for the chosen period and shows the eliminations and warnings', () => {
    const fixture = build();
    fixture.componentInstance.from.set('2026-01-01');
    fixture.componentInstance.to.set('2026-12-31');
    fixture.componentInstance.runNow();
    fixture.detectChanges();
    expect(api.run).toHaveBeenCalledWith('2026-12-31', '2026-01-01');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Inversión en Filial');
    expect(text).toContain('Concilia los saldos');
    expect(api.runs).toHaveBeenCalledTimes(2);
  });

  it('refuses a period that runs backwards without calling the server', () => {
    const fixture = build();
    api.run.mockClear();
    fixture.componentInstance.from.set('2026-12-31');
    fixture.componentInstance.to.set('2026-01-01');
    fixture.componentInstance.runNow();
    expect(api.run).not.toHaveBeenCalled();
  });
});
