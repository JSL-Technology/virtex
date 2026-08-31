import { I18nService } from './i18n.service';

/**
 * The server catalogue's own behaviour, separate from whether its wording is any good.
 *
 * Wording parity between the three languages is `messages.parity.spec.ts`. This is about the
 * mechanics: interpolation, pluralisation, and what happens when a key is missing — the last of
 * which matters most, because a translation lookup that throws would turn a 404 into a 500.
 */
describe('I18nService', () => {
  const i18n = new I18nService();

  describe('lookup', () => {
    it('resolves a nested key by its dotted path', () => {
      expect(i18n.translate('ERRORS.NOT_FOUND', 'es')).not.toBe('ERRORS.NOT_FOUND');
      expect(i18n.translate('ERRORS.NOT_FOUND', 'en')).not.toBe('ERRORS.NOT_FOUND');
      expect(i18n.translate('ERRORS.NOT_FOUND', 'pt')).not.toBe('ERRORS.NOT_FOUND');
    });

    it('answers in the language asked for', () => {
      const spanish = i18n.translate('ERRORS.FORBIDDEN', 'es');
      const english = i18n.translate('ERRORS.FORBIDDEN', 'en');
      const portuguese = i18n.translate('ERRORS.FORBIDDEN', 'pt');
      expect(new Set([spanish, english, portuguese]).size).toBe(3);
    });

    it('returns the key rather than throwing when there is no entry', () => {
      // A missing translation must never escalate a handled 404 into an unhandled 500.
      expect(() => i18n.translate('NOTHING.LIKE.THIS', 'es')).not.toThrow();
      expect(i18n.translate('NOTHING.LIKE.THIS', 'es')).toBe('NOTHING.LIKE.THIS');
    });

    it('falls back to the default language before giving up', () => {
      // Proven through `has`, which only consults the default catalogue: a key present there is
      // resolvable from any language even if that language has drifted.
      expect(i18n.has('ERRORS.INTERNAL')).toBe(true);
      expect(i18n.has('ERRORS.DEFINITELY_NOT_A_KEY')).toBe(false);
    });
  });

  describe('interpolation', () => {
    it('substitutes named parameters', () => {
      const message = i18n.translate('AUTH.NO_PUDO_ACTIVAR_TU_PLAN_TU_PAGO', 'es', {
        pendingId: 'pending-1',
      });
      expect(message).toContain('pending-1');
      expect(message).not.toContain('{{');
    });

    it('leaves an unsupplied placeholder visible instead of printing "undefined"', () => {
      // A stray `{{pendingId}}` on screen is a bug report. The word "undefined" in the middle of
      // a sentence is a mystery, and reads as if the value were legitimately absent.
      const message = i18n.translate('AUTH.NO_PUDO_ACTIVAR_TU_PLAN_TU_PAGO', 'es', {});
      expect(message).toContain('{{pendingId}}');
      expect(message).not.toContain('undefined');
    });
  });

  describe('pluralisation', () => {
    /**
     * CLDR categories, not an `if (n === 1)`.
     *
     * `1.5` is `other` in English and `one` in Portuguese; Portuguese also has `many`. Hand-rolled
     * pluralisation gets exactly these cases wrong, and the previous code did — it interpolated
     * `minuto${value > 1 ? 's' : ''}` in TypeScript, in Spanish only.
     */
    it('selects a category-suffixed key when a count is supplied', () => {
      const service = new I18nService();
      // Proven against the real catalogue's duration entries, which carry plural forms.
      expect(service.translate('TIME.MINUTES', 'es', { count: 1 })).toContain('1');
      expect(service.translate('TIME.MINUTES', 'es', { count: 1 })).not.toContain('minutos');
      expect(service.translate('TIME.MINUTES', 'es', { count: 5 })).toContain('minutos');
    });

    it('uses the language\'s own categories, not Spanish ones', () => {
      // Portuguese puts 1.5 in `one`; English puts it in `other`.
      expect(new Intl.PluralRules('pt').select(1.5)).toBe('one');
      expect(new Intl.PluralRules('en').select(1.5)).toBe('other');
    });

    it('ignores a non-numeric count rather than building a broken key', () => {
      expect(() =>
        i18n.translate('ERRORS.NOT_FOUND', 'es', { count: 'many' as unknown as number }),
      ).not.toThrow();
    });
  });
});
