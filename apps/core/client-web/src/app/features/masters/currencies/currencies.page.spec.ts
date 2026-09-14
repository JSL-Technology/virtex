import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { CurrenciesPage } from './currencies.page';
import { environment } from '../../../../environments/environment';

/**
 * The screen shows the tenant's currencies, and can add one.
 *
 * It used to render three hard-coded rows — Dominican peso, US dollar, euro — and make no request
 * at all, while `GET /currencies` had answered since before the screen was written and the tenant's
 * real list held twenty-three. That is not a stale view of the data: it is unrelated to it. A
 * currency added anywhere else never appeared here, and "New currency" was wired to nothing.
 *
 * The test that stood here asserted the component could be constructed, which was true of the
 * hard-coded version too. These assert the two things that were actually broken: that the list
 * comes from the endpoint, and that creating one reaches it.
 */
describe('Currencies', () => {
  let component: CurrenciesPage;
  let fixture: ComponentFixture<CurrenciesPage>;
  let http: HttpTestingController;

  const API = `${environment.apiUrl}/currencies`;

  const currencies = [
    { id: 'c1', code: 'DOP', name: 'Peso dominicano', symbol: 'RD$' },
    { id: 'c2', code: 'PAB', name: 'Balboa panameño', symbol: 'B/.' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CurrenciesPage] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CurrenciesPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const flushList = (rows = currencies) => {
    http.expectOne(API).flush(rows);
    fixture.detectChanges();
  };

  it('asks the endpoint for the list instead of inventing one', () => {
    flushList();

    expect(component.currencies().map((c) => c.code)).toEqual(['DOP', 'PAB']);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Balboa panameño');
    // The rows the screen used to invent regardless of what the tenant had.
    expect(text).not.toContain('United States Dollar');
  });

  it('reports a failed load and can retry', () => {
    http.expectOne(API).flush({ code: 'INTERNAL_ERROR' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    expect(component.loading()).toBe(false);

    component.load();
    flushList();
    expect(component.error()).toBeNull();
    expect(component.currencies().length).toBe(2);
  });

  it('posts a new currency and reloads', () => {
    flushList();

    component.toggleCreate();
    component.draftCode.set('usd');
    component.draftName.set('US dollar');
    component.draftSymbol.set('$');
    fixture.detectChanges();

    expect(component.canSave()).toBe(true);
    component.save();

    const created = http.expectOne((r) => r.url === API && r.method === 'POST');
    // ISO 4217 is upper case; the field accepts what the user typed and the request is correct.
    expect(created.request.body).toEqual({ code: 'USD', name: 'US dollar', symbol: '$' });
    created.flush({ id: 'c3', code: 'USD', name: 'US dollar', symbol: '$' });

    flushList([...currencies, { id: 'c3', code: 'USD', name: 'US dollar', symbol: '$' }]);
    expect(component.currencies().length).toBe(3);
    expect(component.creating()).toBe(false);
  });

  it('will not post an incomplete draft', () => {
    flushList();
    component.toggleCreate();

    component.draftCode.set('EU'); // not three letters
    component.draftName.set('Euro');
    component.draftSymbol.set('€');
    expect(component.canSave()).toBe(false);

    component.save();
    http.expectNone((r) => r.method === 'POST');
  });
});
