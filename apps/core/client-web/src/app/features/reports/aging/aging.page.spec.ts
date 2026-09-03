import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AgingPage } from './aging.page';
import { AgingReport } from '../../../core/api/aging.service';
import { environment } from '../../../../environments/environment';

/**
 * Ageing existed on neither side of the product. One component serves both, so the assertion that
 * matters most is that the route's own data decides which endpoint it calls — getting that wrong
 * would show a treasurer the receivables when they asked what to pay.
 */
describe('AgingPage', () => {
  let fixture: ComponentFixture<AgingPage>;
  let httpMock: HttpTestingController;

  const report: AgingReport = {
    asOfDate: '2026-03-31',
    rows: [
      {
        partyId: 'p1',
        partyName: 'Suplidora del Caribe',
        current: 1_000,
        buckets: [
          { label: '1-30', from: 1, to: 30, amount: 500 },
          { label: '31-60', from: 31, to: 60, amount: 0 },
          { label: '61-90', from: 61, to: 90, amount: 0 },
          { label: '90+', from: 91, to: null, amount: 250 },
        ],
        total: 1_750,
      },
    ],
    totals: {
      current: 1_000,
      buckets: [
        { label: '1-30', from: 1, to: 30, amount: 500 },
        { label: '31-60', from: 31, to: 60, amount: 0 },
        { label: '61-90', from: 61, to: 90, amount: 0 },
        { label: '90+', from: 91, to: null, amount: 250 },
      ],
      total: 1_750,
    },
  };

  const build = async (side: 'payables' | 'receivables') => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AgingPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { side } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgingPage);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  };

  it('asks accounts payable when the route says payables', async () => {
    await build('payables');
    const request = httpMock.expectOne(
      (candidate) => candidate.url === `${environment.apiUrl}/accounts-payable/aging`,
    );
    request.flush(report);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Suplidora del Caribe');
    httpMock.verify();
  });

  it('asks customer payments when the route says receivables', async () => {
    await build('receivables');
    const request = httpMock.expectOne(
      (candidate) => candidate.url === `${environment.apiUrl}/customer-payments/aging`,
    );
    request.flush(report);
    fixture.detectChanges();
    httpMock.verify();
  });

  it('places each bucket under its own column, whatever order they arrive in', async () => {
    await build('payables');
    const reversed: AgingReport = {
      ...report,
      rows: [{ ...report.rows[0], buckets: [...report.rows[0].buckets].reverse() }],
    };
    httpMock
      .expectOne((candidate) => candidate.url === `${environment.apiUrl}/accounts-payable/aging`)
      .flush(reversed);
    fixture.detectChanges();

    const cells = [...fixture.nativeElement.querySelectorAll('tbody td.numeric')].map(
      (cell: HTMLElement) => cell.textContent?.trim(),
    );
    // current, 1-30, 31-60, 61-90, 90+, total — matched by label, not by position.
    expect(cells[1]).toContain('500');
    expect(cells[4]).toContain('250');
    httpMock.verify();
  });
});
