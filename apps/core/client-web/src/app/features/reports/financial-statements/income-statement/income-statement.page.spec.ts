import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { IncomeStatementPage } from './income-statement.page';
import { IncomeStatementReport } from '../../../../core/api/financial-reporting.service';
import { environment } from '../../../../../environments/environment';

describe('IncomeStatementPage', () => {
  let fixture: ComponentFixture<IncomeStatementPage>;
  let component: IncomeStatementPage;
  let httpMock: HttpTestingController;

  const report: IncomeStatementReport = {
    period: { startDate: '2026-01-01', endDate: '2026-03-31' },
    ledger: { id: 'l1', name: 'Principal', currency: 'DOP' },
    revenue: {
      sections: [
        {
          category: 'OPERATING_REVENUE',
          accounts: [
            {
              accountId: 'a1',
              code: '4101',
              name: { es: 'Ventas', en: 'Sales' },
              type: 'REVENUE',
              category: 'OPERATING_REVENUE',
              amount: 400_000,
            },
          ],
          subtotal: 400_000,
        },
      ],
      total: 400_000,
    },
    costOfSales: { accounts: [], total: 100_000 },
    grossProfit: 300_000,
    operatingExpenses: { accounts: [], total: 120_000 },
    operatingIncome: 180_000,
    nonOperating: { accounts: [], total: 0 },
    netIncome: 180_000,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IncomeStatementPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(IncomeStatementPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const flush = (body: IncomeStatementReport = report) => {
    const request = httpMock.expectOne(
      (c) => c.url === `${environment.apiUrl}/financial-reporting/income-statement`,
    );
    request.flush(body);
    fixture.detectChanges();
    return request;
  };

  it('asks for the period and prints the server’s figures', () => {
    fixture.detectChanges();
    const request = flush();

    expect(request.request.params.get('startDate')).toBe(component.startDate());
    expect(component.report()?.netIncome).toBe(180_000);
    expect(fixture.nativeElement.textContent).toContain('4101');
  });

  it('derives gross margin from the two figures the server sent', () => {
    fixture.detectChanges();
    flush();
    expect(component.grossMargin()).toBeCloseTo(0.75, 6);
  });

  it('reports no margin rather than 0% when there is no revenue', () => {
    fixture.detectChanges();
    flush({
      ...report,
      revenue: { sections: [], total: 0 },
      grossProfit: -100_000,
    });
    // A margin on nothing is absent, not zero — printing 0 % would read as break-even.
    expect(component.grossMargin()).toBeNull();
  });
});
