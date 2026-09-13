import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { OrdersPage } from './orders.page';
import { environment } from '../../../../environments/environment';

/**
 * This page listed four orders written into the component — the same `PO-2025-001
 * OfiSuministros SRL $1,250.00 Sent` for every tenant of the product, with no table behind them.
 * What matters now is that every row on it came from the server.
 */
describe('OrdersPage', () => {
  let fixture: ComponentFixture<OrdersPage>;
  let component: OrdersPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  const page = {
    rows: [
      {
        id: 'o1',
        number: 'PO-2026-000001',
        supplierId: 's1',
        supplier: { id: 's1', name: 'OfiSuministros SRL' },
        orderDate: '2026-09-01',
        expectedDate: null,
        status: 'SENT' as const,
        currencyCode: 'DOP',
        subtotal: 1_000,
        taxTotal: 180,
        total: 1_180,
        requisitionId: null,
        approvedAt: null,
        sentAt: null,
        cancellationReason: null,
        notes: null,
        lines: [],
      },
    ],
    page: 1,
    pageSize: 50,
    total: 1,
    hasMore: false,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrdersPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(OrdersPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  it('lists the tenant’s own orders, from the server', () => {
    httpMock.expectOne((c) => c.url === `${API}/procurement/orders`).flush(page);
    fixture.detectChanges();

    expect(component.orders().map((order) => order.number)).toEqual(['PO-2026-000001']);
    expect(component.loading()).toBe(false);
    httpMock.verify();
  });

  it('distinguishes "nothing yet" from "still loading"', () => {
    // The old page could not: its four rows were there before any request existed.
    expect(component.loading()).toBe(true);

    httpMock.expectOne((c) => c.url === `${API}/procurement/orders`).flush({ ...page, rows: [], total: 0 });
    fixture.detectChanges();

    expect(component.loading()).toBe(false);
    expect(component.orders()).toEqual([]);
    httpMock.verify();
  });

  it('says so when the list cannot be loaded, instead of showing rows that are not there', () => {
    httpMock
      .expectOne((c) => c.url === `${API}/procurement/orders`)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.failed()).toBe(true);
    expect(component.orders()).toEqual([]);
    httpMock.verify();
  });
});
