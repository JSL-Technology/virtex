import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { FormatService, LocaleStore, VxLocalizedNamePipe, VxNarrativePipe } from '@virtex/shared/ui-i18n';
import type { LocaleContextContract } from '@virtex/shared/types';
// The catalogues the application ships: the narratives render only if the client has the messages.
import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';

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

  it('reads a master that keeps its name as text by its translations — the record where it has none', () => {
    expect(store.nameOf('Diario de ventas', { en: 'Sales journal', pt: 'Diário de vendas' })).toBe('Sales journal');
    expect(store.nameOf('Diario de caja', {})).toBe('Diario de caja');
    store.setBooksView(true);
    expect(store.nameOf('Diario de ventas', { en: 'Sales journal' })).toBe('Diario de ventas');
    // A translation filed under the books language does not replace the record.
    store.setBooksView(false);
    expect(store.nameOf('Diario de ventas', { es: 'otro', en: 'Sales journal' })).toBe('Sales journal');
  });

  it('there is no choice to make where the books are in the reader\'s own language', () => {
    store.setTenantContext({ ...dominican, booksLanguage: 'en', countryCode: 'US' });
    expect(store.booksLanguageDiffers()).toBe(false);
  });

  describe('the narratives the system wrote', () => {
    /** As the server stored them: the record, and the message it was written from. */
    const category = {
      description: 'Categoría: Gastos bancarios',
      key: 'ledger.reconciliation.category_line',
      params: { account: { es: 'Gastos bancarios', en: 'Bank charges', pt: 'Despesas bancárias' } },
    };
    const reversal = {
      description: 'Reversión: Ajuste de fin de período (devengo): Intereses',
      key: 'ledger.reversal.line',
      params: {
        line: { key: 'ledger.adjustment.period_end', params: { type: 'ledger.adjustment_type.accrual', description: 'Intereses' } },
      },
    };
    let translate: TranslateService;
    let pipe: VxNarrativePipe;

    beforeEach(() => {
      translate = TestBed.inject(TranslateService);
      translate.setTranslation('en', en as Record<string, string>);
      translate.setTranslation('es', es as Record<string, string>);
      translate.use('en');
      pipe = TestBed.runInInjectionContext(() => new VxNarrativePipe());
    });

    afterEach(() => pipe.ngOnDestroy());

    it('reads in the reader\'s language — the account\'s name in it too', () => {
      expect(pipe.transform(category.description, category.key, category.params)).toBe('Category: Bank charges');
    });

    it('reads a reversal with the narrative it reverses, and a type said in words', () => {
      expect(pipe.transform(reversal.description, reversal.key, reversal.params)).toBe(
        'Reversal: Period-end adjustment (accrual): Intereses',
      );
    });

    it('shows the record in the books view — exactly what an auditor and a filing read', () => {
      store.setBooksView(true);
      expect(pipe.transform(category.description, category.key, category.params)).toBe('Categoría: Gastos bancarios');
    });

    it('shows the record where the books are in the reader\'s language, and what a person typed always', () => {
      expect(pipe.transform('Pago de luz', null, null)).toBe('Pago de luz');
      store.setTenantContext({ ...dominican, booksLanguage: 'en', countryCode: 'US' });
      expect(pipe.transform('Category: Bank charges', category.key, category.params)).toBe('Category: Bank charges');
    });

    it('shows the record, whole, when the catalogue lacks the message', () => {
      expect(pipe.transform('Texto oficial', 'ledger.not_in_this_build', {})).toBe('Texto oficial');
      expect(pipe.transform('Reversión: algo', 'ledger.reversal.line', { line: { key: 'ledger.not_in_this_build', params: {} } })).toBe(
        'Reversión: algo',
      );
    });

    it('renders again when the reader switches language', () => {
      expect(pipe.transform(category.description, category.key, category.params)).toBe('Category: Bank charges');
      store.setLanguage('pt');
      translate.setTranslation('pt', { 'ledger.reconciliation.category_line': 'Categoria: {{account}}' });
      translate.use('pt');
      expect(pipe.transform(category.description, category.key, category.params)).toBe('Categoria: Despesas bancárias');
    });

    it('error messages read an account\'s name in the reader\'s language too, never «[object Object]»', () => {
      const format = TestBed.inject(FormatService);
      expect(format.localizeParams({ code: '6105', name: { es: 'Gastos bancarios', en: 'Bank charges' } })).toEqual({
        code: '6105',
        name: 'Bank charges',
      });
    });
  });
});

