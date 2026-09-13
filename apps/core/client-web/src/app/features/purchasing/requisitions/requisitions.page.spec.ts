import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { RequisitionsPage } from './requisitions.page';
import { environment } from '../../../../environments/environment';

/**
 * This page listed three requisitions written into the component, with a "department" column the
 * data model never had and requester names that belong to nobody — while the endpoint behind it
 * existed the whole time and was never called.
 */
describe('RequisitionsPage', () => {
  let fixture: ComponentFixture<RequisitionsPage>;
  let component: RequisitionsPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  const page = {
    rows: [
      {
        id: 'r1',
        number: 'REQ-2026-000001',
        status: 'PENDING_APPROVAL' as const,
        totalAmount: 9_500,
        requiredDate: '2026-10-01',
        notes: 'Reposición de papelería',
        requestedByUserId: 'u1',
        decidedByUserId: null,
        decidedAt: null,
        rejectionReason: null,
        purchaseOrderId: null,
        createdAt: '2026-09-01T10:00:00.000Z',
        lines: [
          { description: 'Resma de papel A4', quantity: 10, estimatedUnitPrice: 250 },
          { description: 'Tóner negro', quantity: 2, estimatedUnitPrice: 3_500 },
        ],
      },
    ],
    page: 1,
    pageSize: 50,
    total: 1,
    hasMore: false,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RequisitionsPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(RequisitionsPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  it('lists the tenant’s own requisitions, from the server', () => {
    httpMock.expectOne((c) => c.url === `${API}/procurement/requisitions`).flush(page);
    fixture.detectChanges();

    expect(component.requisitions().map((r) => r.number)).toEqual(['REQ-2026-000001']);
    // What replaced the invented "department": how many things were asked for.
    expect(component.itemCount(component.requisitions()[0])).toBe(2);
    httpMock.verify();
  });

  it('says so when the list cannot be loaded', () => {
    httpMock
      .expectOne((c) => c.url === `${API}/procurement/requisitions`)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.failed()).toBe(true);
    httpMock.verify();
  });
});
