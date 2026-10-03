import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { PriceListFormPage } from './price-list-form.page';

/** A new price list is in the company's currency, not USD (QA A-12). */
describe('PriceListFormPage', () => {
  let http: HttpTestingController;

  function create() {
    TestBed.configureTestingModule({
      imports: [PriceListFormPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(LocaleStore).setTenantContext({ countryCode: 'DO', currency: 'DOP' } as never);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PriceListFormPage);
    fixture.detectChanges();
    return fixture;
  }

  it("starts on the books currency and offers the tenant's currencies", () => {
    const fixture = create();
    http.expectOne((r) => r.url.endsWith('/currencies')).flush([
      { id: '1', code: 'DOP', name: 'Peso dominicano', symbol: 'RD$' },
      { id: '2', code: 'EUR', name: 'Euro', symbol: '€' },
    ]);

    const page = fixture.componentInstance;
    expect(page.priceListForm.get('currency')?.value).toBe('DOP');
    expect(page.currencyOptions().map((c) => c.code)).toEqual(['DOP', 'EUR']);
  });

  it('still offers the books currency when the catalogue cannot be read', () => {
    const fixture = create();
    http.expectOne((r) => r.url.endsWith('/currencies')).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(fixture.componentInstance.currencyOptions().map((c) => c.code)).toEqual(['DOP']);
  });
});
