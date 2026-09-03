import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BalanceSheetPage } from './balance-sheet.page';
import { BalanceSheetReport } from '../../../../core/api/financial-reporting.service';
import { environment } from '../../../../../environments/environment';

/**
 * The page used to render nine invented account names with invented figures and make no request
 * at all. The assertions that matter are therefore that it asks the server, and that it prints
 * what came back rather than anything of its own.
 */
describe('BalanceSheetPage', () => {
  let fixture: ComponentFixture<BalanceSheetPage>;
  let component: BalanceSheetPage;
  let httpMock: HttpTestingController;

  const report: BalanceSheetReport = {
    asOfDate: '2026-03-31',
    ledger: { id: 'l1', name: 'Principal', currency: 'DOP' },
    assets: {
      sections: [
        {
          category: 'CURRENT_ASSET',
          accounts: [
            {
              accountId: 'a1',
              code: '1102',
              name: { es: 'Banco Popular', en: 'Popular Bank' },
              type: 'ASSET',
              category: 'CURRENT_ASSET',
              amount: 250_000,
            },
          ],
          subtotal: 250_000,
        },
      ],
      total: 250_000,
    },
    liabilities: { sections: [], total: 0 },
    equity: { sections: [], unclosedResult: 250_000, total: 250_000 },
    totalLiabilitiesAndEquity: 250_000,
    isBalanced: true,
    outOfBalanceBy: 0,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BalanceSheetPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(BalanceSheetPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const flush = (body: BalanceSheetReport = report) => {
    const request = httpMock.expectOne(
      (candidate) => candidate.url === `${environment.apiUrl}/financial-reporting/balance-sheet`,
    );
    expect(request.request.method).toBe('GET');
    request.flush(body);
    fixture.detectChanges();
    return request;
  };

  it('asks the server for the statement instead of carrying its own figures', () => {
    fixture.detectChanges();
    const request = flush();

    expect(request.request.params.get('asOfDate')).toBe(component.asOfDate());
    expect(component.report()?.assets.total).toBe(250_000);
    // The account's name in the reader's language — the store resolves to English here — rather
    // than `name.es` pinned in the template, or the object printed as `[object Object]`.
    expect(fixture.nativeElement.textContent).toContain('Popular Bank');
    expect(fixture.nativeElement.textContent).not.toContain('[object Object]');
    // The invented figures the page used to print.
    expect(fixture.nativeElement.textContent).not.toContain('Propiedades, Planta y Equipo');
  });

  it('says so when the statement does not balance, rather than printing it as if it did', () => {
    fixture.detectChanges();
    flush({ ...report, isBalanced: false, outOfBalanceBy: 1_250.5 });

    expect(fixture.nativeElement.querySelector('.out-of-balance')).toBeTruthy();
  });

  it('reports a failed request instead of showing an empty statement', () => {
    fixture.detectChanges();
    httpMock
      .expectOne(
        (candidate) => candidate.url === `${environment.apiUrl}/financial-reporting/balance-sheet`,
      )
      .flush('nope', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.failed()).toBe(true);
    expect(component.report()).toBeNull();
  });

  it('re-asks when the cut-off date changes', () => {
    fixture.detectChanges();
    flush();

    component.onDateChange('2026-02-28');
    const second = flush();
    expect(second.request.params.get('asOfDate')).toBe('2026-02-28');
  });
});
