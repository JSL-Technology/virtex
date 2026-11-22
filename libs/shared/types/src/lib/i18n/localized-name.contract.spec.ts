import { mergeTranslations, namesOf, localizedNameIn } from './localized-name.contract';

/** The one rule for a name kept in several languages, wherever a master keeps one. */
describe('names kept in several languages', () => {
  describe('mergeTranslations', () => {
    it('sets what is sent with text, removes what is sent empty, and keeps what is not sent', () => {
      expect(mergeTranslations({ en: 'Sales journal', pt: 'Diário de vendas' }, { en: '  Sales book ', pt: '' }, 'es')).toEqual({ en: 'Sales book' });
      expect(mergeTranslations({ en: 'Sales journal', pt: 'Diário de vendas' }, { en: 'Sales book' }, 'es')).toEqual({
        en: 'Sales book',
        pt: 'Diário de vendas',
      });
    });

    it('never takes the books language: that name is the record, edited as the name', () => {
      expect(mergeTranslations({}, { es: 'Diario de ventas', en: 'Sales journal' }, 'es')).toEqual({ en: 'Sales journal' });
      expect(mergeTranslations({ es: 'viejo', en: 'Sales journal' }, undefined, 'es')).toEqual({ en: 'Sales journal' });
    });

    it('keeps only the languages the product speaks, and only text', () => {
      expect(mergeTranslations({}, { fr: 'Journal des ventes', en: 3 as unknown as string }, 'es')).toEqual({});
    });

    it('starts from nothing when there is nothing yet', () => {
      expect(mergeTranslations(null, { pt: 'Diário de vendas' }, 'en')).toEqual({ pt: 'Diário de vendas' });
    });
  });

  describe('namesOf', () => {
    it('is the translations and the record, the record never overridden', () => {
      expect(namesOf('Diario de ventas', { en: 'Sales journal', es: 'otra cosa' }, 'es')).toEqual({ es: 'Diario de ventas', en: 'Sales journal' });
      expect(localizedNameIn(namesOf('Diario de ventas', { en: 'Sales journal' }, 'es'), 'en', 'es')).toBe('Sales journal');
      expect(localizedNameIn(namesOf('Diario de ventas', {}, 'es'), 'en', 'es')).toBe('Diario de ventas');
    });
  });
});
