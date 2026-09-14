import { inject } from '@angular/core';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { DEFAULT_LANGUAGE, LanguageCode, isLanguageCode } from '@virteex/shared/types';
import { LocaleStore, RegionalCatalogue, applyRegionalCatalogue } from '@virteex/shared/ui-i18n';
import spanish from '../../../assets/i18n/es.json';
import regionalOverrides from '../../../assets/i18n/regional.json';

/**
 * The till's catalogue.
 *
 * Its own file rather than the web client's, and a fifteenth of the size: `targets.json` gives the
 * POS five namespaces (`pos`, `errors`, `common`, `actions`, `validation`) out of ninety-seven, so a
 * terminal does not download the chart of accounts to sell a bottle of water. The entries are the
 * same ones the web client gets — both are emitted from `libs/shared/locales` by
 * `tools/i18n/build-catalogues.mjs`, so the two cannot word the same key differently.
 *
 * Spanish is bundled and the other two are chunks, for the same reason as the web client: the till
 * is the one screen in this product that must open instantly, and it is usually offline-tolerant on
 * a shop counter rather than on a good connection.
 */

type Catalogue = Record<string, string>;

const REGIONAL = regionalOverrides as RegionalCatalogue;

function unwrap(module: unknown): Catalogue {
  const record = module as { default?: Catalogue } & Catalogue;
  return (record?.default ?? record) as Catalogue;
}

const CATALOGUES: Readonly<Record<LanguageCode, () => Promise<unknown>>> = {
  es: () => Promise.resolve({ default: spanish }),
  en: () => import('../../../assets/i18n/en.json'),
  pt: () => import('../../../assets/i18n/pt.json'),
};

export class PosTranslateLoader implements TranslateLoader {
  private readonly locale = inject(LocaleStore);

  getTranslation(lang: string): Observable<TranslationObject> {
    const language: LanguageCode = isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE;

    return from(CATALOGUES[language]()).pipe(
      map(unwrap),
      catchError(() => {
        console.error(`[i18n] Could not load the "${language}" catalogue; falling back to Spanish.`);
        return of(unwrap({ default: spanish }));
      }),
      map(
        (base) =>
          applyRegionalCatalogue(base, REGIONAL, this.locale.locale()) as unknown as TranslationObject,
      ),
    );
  }
}
