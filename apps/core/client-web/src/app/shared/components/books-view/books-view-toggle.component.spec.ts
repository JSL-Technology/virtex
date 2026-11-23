import { TestBed } from '@angular/core/testing';
import { LocaleStore } from '@virtex/shared/ui-i18n';
import type { LocaleContextContract } from '@virtex/shared/types';
import { VxBooksViewToggleComponent } from './books-view-toggle.component';

/** «Ver como los libros» on the screens where the books are read. */
describe('VxBooksViewToggleComponent', () => {
  const dominican: LocaleContextContract = {
    language: 'en',
    locale: 'en-US',
    direction: 'ltr',
    countryCode: 'DO',
    currency: 'DOP',
    timezone: 'America/Santo_Domingo',
    booksLanguage: 'es',
    firstDayOfWeek: 0,
  };
  let store: LocaleStore;

  beforeEach(() => {
    localStorage.clear();
    store = TestBed.inject(LocaleStore);
    store.setLanguage('en');
  });

  const render = () => {
    const fixture = TestBed.createComponent(VxBooksViewToggleComponent);
    fixture.detectChanges();
    return fixture;
  };

  it('offers the switch when the books are kept in another language, and turns the books view on and off', () => {
    store.setTenantContext(dominican);
    const fixture = render();
    const box = fixture.nativeElement.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(box.checked).toBe(false);
    // Described for a screen reader by what it changes, not only by its label.
    expect(fixture.nativeElement.querySelector(`#${box.getAttribute('aria-describedby')}`)).not.toBeNull();

    box.click();
    fixture.detectChanges();
    expect(store.booksView()).toBe(true);
    expect(box.checked).toBe(true);

    box.click();
    expect(store.booksView()).toBe(false);
  });

  it('offers nothing when the books are in the reader\'s own language: both readings are one', () => {
    store.setTenantContext({ ...dominican, booksLanguage: 'en', countryCode: 'US' });
    expect(render().nativeElement.querySelector('input')).toBeNull();
  });
});
