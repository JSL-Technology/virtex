import { inject } from '@angular/core';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { DEFAULT_LANGUAGE, LanguageCode, isLanguageCode } from '@virteex/shared/types';
import spanishCore from '../../../assets/i18n/es.core.json';
import regionalOverrides from '../../../assets/i18n/regional.json';
import { LocaleStore, RegionalCatalogue, applyRegionalCatalogue } from '@virteex/shared/ui-i18n';

/**
 * Loads one message catalogue, and only the one being used, with the tenant's country applied.
 *
 * ## Lazy, because a catalogue is not small
 *
 * The loader before this one imported every catalogue statically, so every visitor downloaded the
 * languages they were not reading, and the same files were ALSO copied into `dist/assets` where
 * nothing fetched them — the product shipped its translations twice. A dynamic `import()` lets the
 * bundler emit each catalogue as its own hashed chunk, fetched the first time that language is
 * selected and cached by the service worker after that. Adding a fourth language costs nothing to
 * the three-quarters of readers who do not read it.
 *
 * Spanish used to stay bundled as well, to save the common path a round trip before first paint.
 * That stopped being affordable when the API stopped wording its own errors: the client took on the
 * wording of every domain failure and the catalogue went from 4.059 keys to 4.696 — 367 kB of
 * JavaScript in the initial bundle, which pushed the build past its size budget. All three languages
 * are chunks now, and since `LanguageService.preload()` runs as an app initializer, nothing paints
 * before the catalogue resolves either way: the difference is 367 kB of bundle against one
 * same-origin request the service worker then caches.
 *
 * `es.core.json` is what remains bundled — the shell, sign-in, navigation and error namespaces,
 * 50 kB — and it exists for one case: the chunk that never arrives. A reader on a failing connection
 * gets a readable sign-in page in Spanish rather than a screen of
 * `settings.security.two_factor_title`.
 *
 * ## The regional patch
 *
 * `es-DO` and `es-MX` read the same catalogue and do not use the same words: the year-end bonus is
 * a *regalía pascual* in Santo Domingo and an *aguinaldo* in Monterrey, and the tax identifier is
 * an RNC in one and an RFC in the other. `regional.json` holds only the keys that actually differ —
 * nineteen for the Dominican Republic out of 5.716 — so a country cannot fall behind the base
 * catalogue: what a patch does not mention, it does not change.
 *
 * The patch is applied here rather than merged into the catalogue afterwards, so the table
 * `TranslateService` holds is always complete for the locale in force. `RegionalLocaleEffect` asks
 * for a reload when the tenant's country resolves, which is the only moment the answer changes.
 */

type Catalogue = Record<string, string>;

const REGIONAL = regionalOverrides as RegionalCatalogue;

/**
 * `import()` on a JSON module resolves to a namespace whose `default` holds the table, while the
 * top-level keys are re-exported by name as well. Reading `default` explicitly keeps a spurious
 * `default` entry out of the translation table.
 */
function unwrap(module: unknown): Catalogue {
  const record = module as { default?: Catalogue } & Catalogue;
  return (record?.default ?? record) as Catalogue;
}

/**
 * One entry per supported language, declared as a literal record so that adding a language to
 * `SUPPORTED_LANGUAGES` without adding its catalogue here is a compile error rather than a runtime
 * fallback nobody notices.
 */
const CATALOGUES: Readonly<Record<LanguageCode, () => Promise<unknown>>> = {
  es: () => import('../../../assets/i18n/es.json'),
  en: () => import('../../../assets/i18n/en.json'),
  pt: () => import('../../../assets/i18n/pt.json'),
};

export class LazyTranslateLoader implements TranslateLoader {
  private readonly locale = inject(LocaleStore);

  getTranslation(lang: string): Observable<TranslationObject> {
    const language: LanguageCode = isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE;

    return from(CATALOGUES[language]()).pipe(
      map(unwrap),
      catchError(() => {
        // A chunk that will not load is a network problem, not a translation problem. Falling back
        // to the bundled catalogue keeps the application readable; failing here would render every
        // key on the screen instead.
        console.error(
          `[i18n] Could not load the "${language}" catalogue; falling back to the bundled core.`,
        );
        return of(unwrap({ default: spanishCore }));
      }),
      map((base) => this.withRegionalOverrides(base) as unknown as TranslationObject),
    );
  }

  /**
   * Apply the patch for the tenant's country, if there is one. See `applyRegionalCatalogue`.
   *
   * `wordingLocale` and not `locale`: the second always answers, falling back to `en-US` for an
   * English reader wherever they are, and applying THAT patch told a Dominican company its tax
   * identifier was an EIN. A country's fiscal vocabulary belongs to the country, not to the
   * language the reader happens to have chosen.
   */
  private withRegionalOverrides(base: Catalogue): Catalogue {
    return applyRegionalCatalogue(base, REGIONAL, this.locale.wordingLocale());
  }
}
