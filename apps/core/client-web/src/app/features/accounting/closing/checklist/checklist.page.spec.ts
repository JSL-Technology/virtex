import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ChecklistPage } from './checklist.page';
import { environment } from '../../../../../environments/environment';

/**
 * The page listed three invented checklist templates assigned to invented people. It now shows
 * the checks the server computes from the tenant's own data, for whichever period is chosen.
 */
describe('ChecklistPage', () => {
  let fixture: ComponentFixture<ChecklistPage>;
  let component: ChecklistPage;
  let httpMock: HttpTestingController;

  const periods = [
    {
      id: 'p1',
      name: 'Marzo 2026',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      status: 'CLOSED' as const,
      generalLedgerStatus: 'CLOSED' as const,
      accountsPayableStatus: 'CLOSED' as const,
      accountsReceivableStatus: 'CLOSED' as const,
      inventoryStatus: 'CLOSED' as const,
    },
    {
      id: 'p2',
      name: 'Abril 2026',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      status: 'OPEN' as const,
      generalLedgerStatus: 'OPEN' as const,
      accountsPayableStatus: 'OPEN' as const,
      accountsReceivableStatus: 'OPEN' as const,
      inventoryStatus: 'OPEN' as const,
    },
  ];

  const items = [
    {
      id: 'unposted-journal-entries',
      descriptionKey: 'ACCOUNTING.CHECKLIST.ITEMS.UNPOSTED_JOURNAL_ENTRIES',
      params: { count: 2 },
      isCompleted: false,
      resolutionLink: '/accounting/journal-entries',
    },
    {
      id: 'unapproved-vendor-bills',
      descriptionKey: 'ACCOUNTING.CHECKLIST.ITEMS.UNAPPROVED_VENDOR_BILLS',
      params: { count: 0 },
      isCompleted: true,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChecklistPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ChecklistPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('opens on the earliest open period and shows the computed checks', () => {
    fixture.detectChanges();
    httpMock.expectOne((c) => c.url === `${environment.apiUrl}/accounting/periods`).flush(periods);
    httpMock
      .expectOne((c) => c.url === `${environment.apiUrl}/accounting/periods/p2/closing-checklist`)
      .flush(items);
    fixture.detectChanges();

    expect(component.selectedPeriodId()).toBe('p2');
    expect(component.progress()).toBe(50);
    // The names the page used to print.
    expect(fixture.nativeElement.textContent).not.toContain('Carlos López');
  });

  it('re-asks when another period is chosen', () => {
    fixture.detectChanges();
    httpMock.expectOne((c) => c.url === `${environment.apiUrl}/accounting/periods`).flush(periods);
    httpMock
      .expectOne((c) => c.url === `${environment.apiUrl}/accounting/periods/p2/closing-checklist`)
      .flush(items);
    fixture.detectChanges();

    component.selectPeriod('p1');
    httpMock
      .expectOne((c) => c.url === `${environment.apiUrl}/accounting/periods/p1/closing-checklist`)
      .flush([]);
    fixture.detectChanges();

    expect(component.isEmpty()).toBe(true);
  });

  it('reports a failed request instead of an empty checklist', () => {
    fixture.detectChanges();
    httpMock
      .expectOne((c) => c.url === `${environment.apiUrl}/accounting/periods`)
      .flush('nope', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.failed()).toBe(true);
  });
});
