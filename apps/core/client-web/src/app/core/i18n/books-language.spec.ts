import { TestBed } from '@angular/core/testing';
import { LocaleStore, VxLocalizedNamePipe } from '@virtex/shared/ui-i18n';
import type { LocaleContextContract } from '@virtex/shared/types';

/**
 * The company's data in the reader's language, or as the books keep it (books bilingual).
 *
 * A US controller of a Dominican company reads the interface in English. The chart reads in
 * English too where it has the names — and in Spanish, the books language, where it does not —
 * and the books view shows it exactly as the books, the exports and the filings keep it.
 */
describe('the books language and the reader\'s', () => {
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
    TestBed.configureTestingModule({});
    store = TestBed.inject(LocaleStore);
    store.setLanguage('en');
    store.setTenantContext(dominican);
  });

  it('shows a name in the reader\'s language, and in the books\' where it has no translation', () => {
    expect(store.booksLanguageDiffers()).toBe(true);
    expect(store.nameOf({ es: 'Bancos', en: 'Bank Accounts' })).toBe('Bank Accounts');
    expect(store.nameOf({ es: 'Viáticos de ventas' })).toBe('Viáticos de ventas');
    expect(store.nameOf('Caja chica')).toBe('Caja chica');
    expect(store.nameOf(null)).toBe('');
  });

  it('the books view shows the data as the books keep it, and the choice outlives the page', () => {
    store.setBooksView(true);
    expect(store.dataLanguage()).toBe('es');
    expect(store.nameOf({ es: 'Bancos', en: 'Bank Accounts' })).toBe('Bancos');
    // The interface does not change language: only the company's data does.
    expect(store.language()).toBe('en');
    expect(localStorage.getItem('vx-books-view')).toBe('1');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const reopened = TestBed.inject(LocaleStore);
    expect(reopened.booksView()).toBe(true);
  });

  it('the name pipe follows the same language', () => {
    const pipe = TestBed.runInInjectionContext(() => new VxLocalizedNamePipe());
    expect(pipe.transform({ es: 'Bancos', en: 'Bank Accounts', pt: 'Bancos' })).toBe('Bank Accounts');
    store.setBooksView(true);
    expect(pipe.transform({ es: 'Bancos', en: 'Bank Accounts', pt: 'Bancos' })).toBe('Bancos');
  });

  it('there is no choice to make where the books are in the reader\'s own language', () => {
    store.setTenantContext({ ...dominican, booksLanguage: 'en', countryCode: 'US' });
    expect(store.booksLanguageDiffers()).toBe(false);
  });
});
