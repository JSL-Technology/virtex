import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { environment } from '../../environments/environment';
import type { CatalogueItem } from '../core/pos-api.service';
import { ToastService } from '../core/toast.service';
import { startTender } from '../domain/payment';
import { TillStore } from './till.store';

const POS = `${environment.apiUrl}/pos`;
const coffee: CatalogueItem = {
  id: 'p1',
  name: 'Café',
  sku: 'CAF',
  barcode: '746',
  price: 100,
  taxRate: 0.18,
  kind: 'GOOD',
  stock: 5,
  unitOfMeasure: 'UND',
  imageUrl: null,
  categoryId: null,
  categoryName: null,
};

describe('TillStore', () => {
  let till: TillStore;
  let http: HttpTestingController;
  let toast: { [k: string]: jest.Mock };

  beforeEach(() => {
    localStorage.clear();
    localStorage.clear();
    toast = {
      success: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
      info: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ToastService, useValue: toast },
        // Every key "exists", so the server's message key is shown as-is.
        {
          provide: TranslateService,
          useValue: { instant: (k: string) => `t:${k}` },
        },
        {
          provide: LocaleStore,
          useValue: { setTenantContext: jest.fn(), setLanguage: jest.fn() },
        },
      ],
    });
    till = TestBed.inject(TillStore);
    http = TestBed.inject(HttpTestingController);
    till.shift.set({
      id: 's1',
      terminalId: 'main',
      userId: 'u1',
      status: 'OPEN',
      openingBalance: 0,
      salesTotal: 0,
      salesCount: 0,
      openedAt: '',
    });
  });

  afterEach(() => http.verify());

  it('a sale that cannot reach the server is kept in the outbox and sent later with the same key', async () => {
    till.add(coffee);
    let result: unknown;
    till.charge({ ...startTender(118), cash: 200 }).subscribe((sale) => (result = sale));
    const first = http.expectOne(`${POS}/sales`);
    const key = first.request.headers.get('Idempotency-Key');
    expect(key).toBeTruthy();
    expect(first.request.body).toMatchObject({
      subtotal: 100,
      tax: 18,
      total: 118,
      payments: [{ method: 'cash', amount: 200 }],
    });
    first.error(new ProgressEvent('error'), { status: 0 });

    // The counter is not blocked: the ticket clears and a provisional sale is shown.
    expect(till.lines()).toEqual([]);
    expect((result as { status: string }).status).toBe('PENDING_SYNC');
    expect(till.outbox.pending().map((e) => e.key)).toEqual([key]);
    expect(till.outbox.pending()[0].payload.capturedAt).toBeTruthy();

    const sync = till.outbox.sync();
    const retry = http.expectOne(`${POS}/sales`);
    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    expect(retry.request.body.capturedAt).toBeTruthy();
    retry.flush({
      id: 'sale-1',
      total: 118,
      items: [],
      payments: [],
      changeDue: 82,
      status: 'PAID',
      createdAt: '',
    });
    await sync;
    http.expectOne(`${POS}/catalog`).flush([coffee]);
    http.expectOne((r) => r.url === `${POS}/shifts/active`).flush(null);
    expect(till.outbox.entries()).toEqual([]);
  });

  it('a sale the server refuses from the outbox is set aside for the cashier, not retried forever', async () => {
    till.add(coffee);
    till.charge(startTender(118)).subscribe();
    http.expectOne(`${POS}/sales`).error(new ProgressEvent('error'), { status: 0 });

    const sync = till.outbox.sync();
    http
      .expectOne(`${POS}/sales`)
      .flush({ messageKey: 'pos.product_not_available' }, { status: 400, statusText: 'Bad Request' });
    await sync;
    expect(till.outbox.pending()).toEqual([]);
    expect(till.outbox.failed()).toHaveLength(1);
  });

  it('a new cart gets a new key', () => {
    till.add(coffee);
    till.charge(startTender(118)).subscribe({ error: () => void 0 });
    const first = http.expectOne(`${POS}/sales`);
    const key = first.request.headers.get('Idempotency-Key');
    first.flush({ messageKey: 'pos.totals_changed' }, { status: 409, statusText: 'Conflict' });
    http.expectOne(`${POS}/catalog`).flush([coffee]);
    till.increment('p1', 1);
    till.charge(startTender(236)).subscribe({ error: () => void 0 });
    const second = http.expectOne(`${POS}/sales`);
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(key);
    second.flush({ messageKey: 'pos.sale_error' }, { status: 400, statusText: 'Bad Request' });
  });

  it('sends the buyer\'s RNC, digits only, when one is given', () => {
    till.add(coffee);
    till.customerTaxId.set('1-01-00000-1');
    till.charge(startTender(118)).subscribe({ error: () => void 0 });
    const req = http.expectOne(`${POS}/sales`);
    expect(req.request.body.customerTaxId).toBe('101000001');
    req.flush({ messageKey: 'pos.sale_error' }, { status: 400, statusText: 'Bad Request' });
  });

  it('when the server says prices moved, the catalogue is reloaded and the ticket re-priced', () => {
    till.add(coffee);
    till.charge(startTender(118)).subscribe({ error: () => void 0 });
    http
      .expectOne(`${POS}/sales`)
      .flush(
        { messageKey: 'pos.prices_changed' },
        { status: 409, statusText: 'Conflict' },
      );
    http.expectOne(`${POS}/catalog`).flush([{ ...coffee, price: 120 }]);
    expect(till.lines()[0].price).toBe(120);
    expect(toast['error']).toHaveBeenCalledWith('pos.prices_changed');
  });

  it('parks a ticket and recalls it, parking the open one in its place', () => {
    till.add(coffee);
    till.customer.set('Ana');
    expect(till.park()).toBe(true);
    expect(till.lines()).toEqual([]);
    till.catalogue.set([coffee]);
    till.add({ ...coffee, id: 'p2', name: 'Agua' });
    const parkedId = till.parked()[0].id;
    till.recall(parkedId);
    expect(till.customer()).toBe('Ana');
    expect(till.lines().map((l) => l.productId)).toEqual(['p1']);
    expect(till.parked()).toHaveLength(1);
    expect(till.parked()[0].lines[0].productId).toBe('p2');
  });

  it('refuses an out-of-stock good at the counter', () => {
    expect(till.add({ ...coffee, stock: 0 })).toBe(false);
    expect(toast['warning']).toHaveBeenCalledWith('pos.out_of_stock_named', {
      name: 'Café',
    });
  });
});
