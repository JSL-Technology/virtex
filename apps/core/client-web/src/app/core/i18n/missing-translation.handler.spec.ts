import { VirtexMissingTranslationHandler, resetMissingTranslationLog } from '@virteex/shared/ui-i18n';

/**
 * QA M-17: «Draft», «ADMINISTRATOR» in a Spanish screen — keys composed from an upper-case API
 * value missed the lower-case catalogue key.
 */
describe('VirtexMissingTranslationHandler', () => {
  const catalogue: Record<string, string> = { 'masters.price_lists.status_label.draft': 'Borrador' };
  const translateService = {
    currentLang: 'es',
    instant: (key: string) => catalogue[key] ?? handler.handle({ key, translateService } as never),
  };
  const handler = new VirtexMissingTranslationHandler();

  beforeEach(() => resetMissingTranslationLog());

  it('finds the lower-case key a composed upper-case one stands for', () => {
    expect(handler.handle({ key: 'masters.price_lists.status_label.DRAFT', translateService } as never)).toBe('Borrador');
    expect(handler.handle({ key: 'masters.price_lists.status_label.Draft', translateService } as never)).toBe('Borrador');
  });

  it('still falls back when neither form exists', () => {
    const result = handler.handle({ key: 'masters.price_lists.status_label.ARCHIVED', translateService } as never);
    expect(result).not.toBe('Borrador');
  });
});
