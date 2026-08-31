import {
  DEFAULT_LANGUAGE,
  DEFAULT_LOCALE,
  LANGUAGE_DIRECTION,
  LANGUAGE_ENDONYMS,
  SUPPORTED_LANGUAGES,
  SUPPORTED_LOCALES,
  isLanguageCode,
  isLocaleTag,
  languageOfLocale,
  matchLanguage,
  negotiateLanguage,
  resolveLocale,
} from './locale.contract';

/**
 * Language negotiation is the one piece of i18n with no visible failure mode.
 *
 * Getting it wrong does not throw and does not render a placeholder: it renders the wrong
 * language, fluently, to somebody who cannot tell that a preference was ignored. The header
 * grammar has enough corners — quality values, `q=0` as a refusal, the wildcard, the
 * language-only match against a regional tag — that "it looked right" is not evidence.
 */
describe('locale contract', () => {
  describe('the catalogue lists agree with themselves', () => {
    it('every language has an endonym and a direction', () => {
      for (const language of SUPPORTED_LANGUAGES) {
        expect(LANGUAGE_ENDONYMS[language]).toBeTruthy();
        expect(LANGUAGE_DIRECTION[language]).toMatch(/^(ltr|rtl)$/);
      }
    });

    it('every locale is built from a supported language', () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(SUPPORTED_LANGUAGES).toContain(languageOfLocale(locale));
      }
    });

    it('the defaults are members of their own lists', () => {
      expect(isLanguageCode(DEFAULT_LANGUAGE)).toBe(true);
      expect(isLocaleTag(DEFAULT_LOCALE)).toBe(true);
    });

    it('every locale is one Intl actually understands', () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(() => new Intl.NumberFormat(locale).format(1)).not.toThrow();
        expect(Intl.NumberFormat.supportedLocalesOf([locale]).length).toBe(1);
      }
    });
  });

  describe('matchLanguage', () => {
    it.each([
      ['es', 'es'],
      ['ES', 'es'],
      ['es-DO', 'es'],
      ['es_do', 'es'],
      ['pt-BR', 'pt'],
      ['  en-GB  ', 'en'],
    ])('%s → %s', (input, expected) => {
      expect(matchLanguage(input)).toBe(expected);
    });

    it.each([['fr'], ['zh-Hant-TW'], [''], ['   '], [null], [undefined]])(
      'refuses %s rather than guessing',
      (input) => {
        expect(matchLanguage(input as string)).toBeNull();
      },
    );
  });

  describe('negotiateLanguage', () => {
    it('picks the highest quality supported language, not the first one listed', () => {
      expect(negotiateLanguage('fr-CA,fr;q=0.9,en;q=0.8')).toBe('en');
    });

    it('honours header order within one quality band', () => {
      expect(negotiateLanguage('pt,es')).toBe('pt');
      expect(negotiateLanguage('es,pt')).toBe('es');
    });

    it('matches a regional tag against its base catalogue', () => {
      expect(negotiateLanguage('es-DO,es;q=0.9')).toBe('es');
      expect(negotiateLanguage('pt-BR')).toBe('pt');
    });

    it('treats q=0 as a refusal, not as a low preference', () => {
      // The reader has explicitly said "not Spanish". Falling back to it would be the one
      // outcome the header ruled out.
      expect(negotiateLanguage('de,es;q=0')).toBeNull();
      expect(negotiateLanguage('de,es;q=0,en;q=0.5')).toBe('en');
    });

    it('resolves the wildcard to the default language', () => {
      expect(negotiateLanguage('*')).toBe(DEFAULT_LANGUAGE);
    });

    it('does not let the wildcard resurrect a refused language', () => {
      expect(negotiateLanguage(`${DEFAULT_LANGUAGE};q=0,*`)).toBeNull();
    });

    it('returns null when nothing is supported, so the caller can fall back', () => {
      expect(negotiateLanguage('fr,de;q=0.8')).toBeNull();
      expect(negotiateLanguage('')).toBeNull();
      expect(negotiateLanguage(null)).toBeNull();
    });

    it('survives a malformed header instead of throwing', () => {
      expect(() => negotiateLanguage(';;;,q=,,')).not.toThrow();
      expect(negotiateLanguage('en;q=notanumber')).toBeNull();
      expect(negotiateLanguage('en;q=')).toBeNull();
    });
  });

  describe('resolveLocale', () => {
    it('pairs the language with the tenant country', () => {
      expect(resolveLocale('es', 'DO')).toBe('es-DO');
      expect(resolveLocale('es', 'mx')).toBe('es-MX');
      expect(resolveLocale('pt', 'BR')).toBe('pt-BR');
      expect(resolveLocale('en', 'US')).toBe('en-US');
    });

    it('falls back to the neutral locale for a pair it does not format for', () => {
      // An English speaker in a Dominican tenant. There is no `en-DO` in CLDR worth pretending
      // to have, so the interface formats as en-US rather than inventing one.
      expect(resolveLocale('en', 'DO')).toBe('en-US');
      expect(resolveLocale('pt', 'DO')).toBe('pt-BR');
      expect(resolveLocale('es', 'ZZ')).toBe('es-419');
      expect(resolveLocale('es', null)).toBe('es-419');
    });
  });
});
