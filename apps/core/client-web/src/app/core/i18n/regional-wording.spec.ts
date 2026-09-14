import { TestBed } from '@angular/core/testing';

import { LocaleStore } from '@virteex/shared/ui-i18n';

/**
 * A country's fiscal vocabulary belongs to the country, not to the reader's language.
 *
 * The regional patches carry exactly that vocabulary — RNC, RFC, CUIT, EIN. The locale they were
 * chosen by was `language + tenant country`, falling back to the language's neutral locale when
 * the pair had no patch. For an English-speaking controller in a Dominican company that pair is
 * `en-DO`, there is no such patch, and the fallback was `en-US` — so the customer form asked a
 * Santo Domingo business for its EIN, and the company profile labelled its RNC field "EIN".
 *
 * Reading the interface in English does not move the company to Delaware.
 */
describe('Regional wording follows the tenant, not the reader', () => {
  let store: LocaleStore;

  beforeEach(() => {
    store = TestBed.inject(LocaleStore);
  });

  const inTenant = (countryCode: string, language: 'es' | 'en' | 'pt') => {
    store.setTenantContext({ countryCode } as never);
    store.setLanguage(language);
  };

  it('uses the country patch when the reader shares its language', () => {
    inTenant('DO', 'es');
    expect(store.wordingLocale()).toBe('es-DO');
  });

  it('applies no patch at all rather than another country’s', () => {
    inTenant('DO', 'en');
    // Not `en-US`. "Tax ID" is less specific than "RNC"; "EIN" is simply false.
    expect(store.wordingLocale()).toBeNull();
    // Formatting still has to answer something, and that answer is unchanged.
    expect(store.locale()).toBe('en-US');
  });

  it('still gives an American tenant its own wording', () => {
    inTenant('US', 'en');
    expect(store.wordingLocale()).toBe('en-US');
  });

  it('applies no patch before a tenant is known', () => {
    store.setTenantContext(null as never);
    store.setLanguage('es');
    expect(store.wordingLocale()).toBeNull();
  });

  it('is unmoved by the spelling of the country code', () => {
    inTenant(' do ', 'es');
    expect(store.wordingLocale()).toBe('es-DO');
  });

  it('never names a country other than the tenant’s', () => {
    // The property that actually matters, across every language a reader can choose. `es-PA` is a
    // real locale tag with no patch file, and `applyRegionalCatalogue` leaves the base catalogue
    // alone for a locale it has no patch for — so what has to hold here is not "null", it is that
    // the country half is never somebody else's.
    for (const country of ['DO', 'US', 'MX', 'PA', 'BR']) {
      for (const language of ['es', 'en', 'pt'] as const) {
        inTenant(country, language);
        const wording = store.wordingLocale();
        if (wording !== null) {
          expect(wording.split('-')[1]).toBe(country);
        }
      }
    }
  });
});
