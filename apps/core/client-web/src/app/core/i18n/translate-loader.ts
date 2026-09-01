import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { DEFAULT_LANGUAGE, LanguageCode, isLanguageCode } from '@virteex/shared/types';
import spanish from '../../../assets/i18n/es.json';

/**
 * Loads one message catalogue, and only the one being used.
 *
 * ## What this replaces
 *
 * The previous loader imported every catalogue statically:
 *
 *     import * as en from '../../../assets/i18n/en.json';
 *     import * as es from '../../../assets/i18n/es.json';
 *     return of(lang === 'es' ? es : en);
 *
 * That put both catalogues — 94 KB before compression — into the initial bundle, so every visitor
 * downloaded the language they were not reading, and it grew linearly with each market added.
 * The same files were ALSO copied into `dist/assets` by the build, and nothing ever fetched them,
 * because the HTTP loader had been commented out. The product shipped its translations twice and
 * loaded them in the most expensive way available.
 *
 * A dynamic `import()` lets the bundler emit each catalogue as its own hashed chunk, fetched the
 * first time that language is selected and cached by the service worker thereafter. Adding a
 * fourth language costs nothing to the three-quarters of users who do not read it.
 *
 * ## Why Spanish is still bundled
 *
 * It is the default and the majority language, so the common path must not pay a round trip
 * before the first paint — and it doubles as the last-resort catalogue when a chunk cannot be
 * fetched at all. A user on a bad connection sees Spanish, which is a worse experience than
 * their own language and a much better one than a screen of `SETTINGS.SECURITY.2FA_TITLE`.
 */

type Catalogue = Record<string, unknown>;

/**
 * `import()` on a JSON module resolves to a namespace whose `default` holds the tree, while the
 * top-level keys are also re-exported by name. Reading `default` explicitly is what keeps a
 * spurious `default` branch out of the translation table.
 */
function unwrap(module: unknown): TranslationObject {
  const record = module as { default?: Catalogue } & Catalogue;
  return (record?.default ?? record) as TranslationObject;
}

/**
 * One entry per supported language, declared as a literal record so that adding a language to
 * `SUPPORTED_LANGUAGES` without adding its catalogue here is a compile error rather than a
 * runtime fallback nobody notices.
 */
const CATALOGUES: Readonly<Record<LanguageCode, () => Promise<unknown>>> = {
  es: () => Promise.resolve({ default: spanish }),
  en: () => import('../../../assets/i18n/en.json'),
  pt: () => import('../../../assets/i18n/pt.json'),
};

export class LazyTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<TranslationObject> {
    const language: LanguageCode = isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE;

    return from(CATALOGUES[language]()).pipe(
      map(unwrap),
      catchError(() => {
        // A chunk that will not load is a network problem, not a translation problem. Falling
        // back to the bundled catalogue keeps the application readable; failing here would render
        // every key on the screen instead.
        console.error(`[i18n] Could not load the "${language}" catalogue; falling back to Spanish.`);
        return of(unwrap({ default: spanish }));
      }),
    );
  }
}
