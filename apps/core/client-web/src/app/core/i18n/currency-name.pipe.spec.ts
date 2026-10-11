import { TestBed } from '@angular/core/testing';
import { LocaleStore, VxCurrencyNamePipe } from '@virteex/shared/ui-i18n';

/** QA M4: the currency pickers named every currency in Spanish whatever the reader's language. */
describe('vxCurrencyName', () => {
  function pipeIn(language: string): VxCurrencyNamePipe {
    TestBed.configureTestingModule({ providers: [VxCurrencyNamePipe] });
    TestBed.inject(LocaleStore).setLanguage(language);
    return TestBed.runInInjectionContext(() => new VxCurrencyNamePipe());
  }

  it('names an ISO currency in the reader’s language, not in the stored one', () => {
    expect(pipeIn('en').transform('DOP', 'Peso dominicano')).toBe('Dominican Peso');
  });

  it('follows the reader into Spanish and Portuguese', () => {
    expect(pipeIn('es').transform('USD', 'Dólar estadounidense').toLowerCase()).toBe('dólar estadounidense');
    TestBed.resetTestingModule();
    expect(pipeIn('pt').transform('EUR', 'Euro')).toBe('Euro');
  });

  it('keeps the stored name for a code the browser does not know', () => {
    const pipe = pipeIn('en');
    expect(pipe.transform('XQQ', 'Unidad interna')).toBe('Unidad interna');
    expect(pipe.transform(null, null)).toBe('');
  });
});
