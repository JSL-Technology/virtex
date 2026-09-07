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
    investing: {
      movements: [
        { accountId: 'a3', code: '1501', inflow: 10_000, outflow: 30_000, amount: -20_000 },
      ],
      inflows: 10_000,
      outflows: 30_000,
      total: -20_000,
    },
    financing: {
      movements: [
        { accountId: 'a4', code: '2501', inflow: 48_000, outflow: 40_000, amount: 8_000 },
      ],
      inflows: 48_000,
      outflows: 40_000,
      total: 8_000,
    },
    effectOfExchangeRateOnCash: 0,
    nonCashTransactions: [],
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

  it('prints investing and financing gross, not as a single net figure', () => {
    fixture.detectChanges();
    flush();

    // IAS 7.21: cash in and cash out are two figures. The page has to show both, or the gross
    // presentation the server now produces is thrown away on the way to the reader.
    const line = [...fixture.nativeElement.querySelectorAll('.gross-line')].find(
      (row: HTMLElement) => row.textContent?.includes('1501'),
    ) as HTMLElement;
    expect(line).toBeTruthy();
    const amounts = [...line.querySelectorAll('.amount')].map((cell) => cell.textContent?.trim());
    expect(amounts[0]).toContain('10,000');
    expect(amounts[1]).toContain('30,000');
    expect(amounts[2]).toContain('20,000');
  });

  it('gives the effect of exchange rates on cash its own line when there is one', () => {
    fixture.detectChanges();
    flush({ ...report, effectOfExchangeRateOnCash: 4_000 });

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('EFECTO_TIPO_CAMBIO');
    expect(text).toContain('4,000');
  });

  it('discloses non-cash investing and financing transactions below the statement', () => {
    fixture.detectChanges();
    flush({
      ...report,
      nonCashTransactions: [
        { accountId: 'a5', code: '1501', debit: 120_000, credit: 0 },
        { accountId: 'a6', code: '2501', debit: 0, credit: 120_000 },
      ],
    });

    const disclosure = fixture.nativeElement.querySelector('.non-cash');
    expect(disclosure).toBeTruthy();
    expect(disclosure.textContent).toContain('120,000');
  });
});
