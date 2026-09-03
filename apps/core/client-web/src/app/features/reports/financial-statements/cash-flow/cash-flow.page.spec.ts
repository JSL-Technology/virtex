import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { CashFlowPage } from './cash-flow.page';
import { CashFlowStatementReport } from '../../../../core/api/financial-reporting.service';
import { environment } from '../../../../../environments/environment';

describe('CashFlowPage', () => {
  let fixture: ComponentFixture<CashFlowPage>;
  let httpMock: HttpTestingController;

  const report: CashFlowStatementReport = {
    period: { startDate: '2026-01-01', endDate: '2026-03-31' },
    ledger: { id: 'l1', name: 'Principal', currency: 'DOP' },
    openingCash: 50_000,
    operating: {
      netIncome: 180_000,
      nonCashAdjustments: [{ accountId: 'a1', code: '5401', amount: 12_000 }],
      workingCapitalChanges: [{ accountId: 'a2', code: '1105', amount: -30_000 }],
      total: 162_000,
    },
    investing: { movements: [], total: -20_000 },
    financing: { movements: [], total: 8_000 },
    netChangeInCash: 150_000,
    closingCash: 200_000,
    unexplainedDifference: 0,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CashFlowPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(CashFlowPage);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const flush = (body: CashFlowStatementReport = report) => {
    httpMock
      .expectOne((c) => c.url === `${environment.apiUrl}/financial-reporting/cash-flow-statement`)
      .flush(body);
    fixture.detectChanges();
  };

  it('prints the statement the server derived', () => {
    fixture.detectChanges();
    flush();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('5401');
    expect(text).toContain('1105');
    expect(fixture.nativeElement.querySelector('.out-of-balance')).toBeFalsy();
  });

  it('shows an unexplained difference, which by construction should never occur', () => {
    fixture.detectChanges();
    flush({ ...report, unexplainedDifference: 42.5 });
    // The statement is derived from the movements it explains, so a non-zero value means the
    // derivation itself is wrong. Hiding it would hide a defect in the report, not in the books.
    expect(fixture.nativeElement.querySelector('.out-of-balance')).toBeTruthy();
  });
});
