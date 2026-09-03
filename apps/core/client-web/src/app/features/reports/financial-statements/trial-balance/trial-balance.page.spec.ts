import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { TrialBalancePage } from './trial-balance.page';
import { TrialBalanceReport } from '../../../../core/api/financial-reporting.service';
import { environment } from '../../../../../environments/environment';

/**
 * The trial balance had no page and no route: the working paper an accountant opens before any
 * other could not be reached. What matters here is that the agreement of the six columns is
 * reported as the server computed it, and that a failure to agree is stated rather than hidden.
 */
describe('TrialBalancePage', () => {
  let fixture: ComponentFixture<TrialBalancePage>;
  let component: TrialBalancePage;
  let httpMock: HttpTestingController;

  const report: TrialBalanceReport = {
    period: { startDate: '2026-01-01', endDate: '2026-03-31' },
    ledger: { id: 'l1', name: 'Principal', currency: 'DOP' },
    rows: [
      {
        accountId: 'a1',
        code: '1102',
        name: { es: 'Banco Popular', en: 'Popular Bank' },
        type: 'ASSET',
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: 250_000,
        periodCredit: 0,
        closingDebit: 250_000,
        closingCredit: 0,
      },
      {
        accountId: 'a2',
        code: '4101',
        name: { es: 'Ventas', en: 'Sales' },
        type: 'REVENUE',
        openingDebit: 0,
        openingCredit: 0,
        periodDebit: 0,
        periodCredit: 250_000,
        closingDebit: 0,
        closingCredit: 250_000,
      },
    ],
    totals: {
      openingDebit: 0,
      openingCredit: 0,
      periodDebit: 250_000,
      periodCredit: 250_000,
      closingDebit: 250_000,
      closingCredit: 250_000,
    },
    isBalanced: true,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrialBalancePage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(TrialBalancePage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const flush = (body: TrialBalanceReport = report) => {
    const request = httpMock.expectOne(
      (candidate) => candidate.url === `${environment.apiUrl}/financial-reporting/trial-balance`,
    );
    request.flush(body);
    fixture.detectChanges();
    return request;
  };

  it('asks the server for the period and prints the rows it returns', () => {
    fixture.detectChanges();
    const request = flush();

    expect(request.request.params.get('startDate')).toBe(component.startDate());
    expect(request.request.params.get('endDate')).toBe(component.endDate());
    expect(fixture.nativeElement.textContent).toContain('1102');
    expect(fixture.nativeElement.querySelector('.balance-check--ok')).toBeTruthy();
  });

  it("says so when the columns do not agree", () => {
    fixture.detectChanges();
    flush({ ...report, isBalanced: false });

    expect(fixture.nativeElement.querySelector('.balance-check--error')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.balance-check--ok')).toBeFalsy();
  });

  it('reports a failed request rather than an empty balance', () => {
    fixture.detectChanges();
    httpMock
      .expectOne(
        (candidate) => candidate.url === `${environment.apiUrl}/financial-reporting/trial-balance`,
      )
      .flush('nope', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.failed()).toBe(true);
    expect(component.report()).toBeNull();
  });
});
