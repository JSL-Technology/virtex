import { Injectable, computed, effect, inject, signal, PLATFORM_ID } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_DIRECTION,
  LanguageCode,
  LocaleContextContract,
  LocaleTag,
  NEUTRAL_LOCALE,
  isLanguageCode,
  matchLanguage,
  resolveLocale,
} from '@virteex/shared/types';

/**
 * The one place that knows what language and locale this session is in.
 *
 * ## Why this is a separate, dependency-free store
 *
 * The previous `LanguageService` injected `AuthService`, which meant the language could not be
 * read from anywhere `AuthService` itself needed — and `AuthService` needs it, to send a signed-out
 * user to the sign-in page in the language they were just reading. The cycle was avoided only
 * because nobody had tried. This store injects nothing but the platform, so everything can depend
 * on it and it depends on nothing; `LanguageService` sits on top and owns the *policy* (what to do
 * when a user signs in, when to persist a preference).
 *
 * ## Interface language is not formatting locale
 *
 * They are separate signals because they answer different questions and change for different
 * reasons. `language` is what the reader chose; `locale` is `language` combined with the tenant's
 * country. An English-speaking controller in a Dominican subsidiary reads `en` and formats as
 * `en-US`, while the amounts are DOP and the dates are the tenant's — see `FormatService`.
 */

/**
 * Where the choice is remembered between visits.
 *
 * One key. There used to be two — `LanguageService` wrote `ui_lang` and the auth footer wrote
 * `lang` — so the language switcher on the sign-in page appeared to work and was forgotten on
 * the next page load.
 */
export const LANGUAGE_STORAGE_KEY = 'vx-language';

/** Storage keys this build no longer writes, cleared on first run so they cannot be read again. */
const LEGACY_STORAGE_KEYS = ['ui_lang', 'lang'];

@Injectable({ providedIn: 'root' })
export class LocaleStore {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** The catalogue the interface renders from. */
  private readonly _language = signal<LanguageCode>(DEFAULT_LANGUAGE);
  readonly language = this._language.asReadonly();

  /**
   * The tenant's locale context, as resolved by the server. Null until a session exists — a
   * signed-out visitor has no tenant, so there is nothing to know beyond their own language.
   */
  private readonly _tenantContext = signal<LocaleContextContract | null>(null);
  readonly tenantContext = this._tenantContext.asReadonly();

  /** Regional locale for dates, numbers and sorting: the language, placed in the tenant's country. */
  readonly locale = computed<LocaleTag>(() => {
    const language = this._language();
    const country = this._tenantContext()?.countryCode;
    return country ? resolveLocale(language, country) : NEUTRAL_LOCALE[language];
  });

  /**
   * The timezone accounting dates are rendered in.
   *
   * The tenant's, never the reader's. A journal entry posted on the first of the month in Santo
   * Domingo must not read as the last day of the previous month because the reader is in Los
   * Angeles — inside a closed period that is a reconciliation error, not a display preference.
   * Falls back to the browser's only when there is no tenant yet (the public pages), where no
   * accounting date is shown anyway.
   */
  readonly timezone = computed<string>(
    () => this._tenantContext()?.timezone ?? this.browserTimezone(),
  );

  /** The tenant's functional currency, used for amounts that carry no code of their own. */
  readonly currency = computed<string>(() => this._tenantContext()?.currency ?? 'USD');

  /** The statutory language of the ledger. Independent of who is reading it. */
  readonly booksLanguage = computed<LanguageCode>(
    () => this._tenantContext()?.booksLanguage ?? this._language(),
  );

  readonly direction = computed<'ltr' | 'rtl'>(() => LANGUAGE_DIRECTION[this._language()]);

  constructor() {
    this._language.set(this.readInitialLanguage());

    // The document must always agree with the store. Doing it here, rather than at each place
    // that changes the language, is what makes it impossible for a switcher to change the text
    // and leave `<html lang>` behind — which is what the auth-footer switcher did, and is a
    // WCAG 2.2 SC 3.1.1 failure as well as a wrong announcement in a screen reader.
    effect(() => {
      const language = this._language();
      if (!this.isBrowser) return;
      this.document.documentElement.lang = language;
      this.document.documentElement.dir = LANGUAGE_DIRECTION[language];
      this.write(LANGUAGE_STORAGE_KEY, language);
    });
  }

  /** Change the interface language. Returns false when the code is not one this build has. */
  setLanguage(language: string): boolean {
    const matched = matchLanguage(language);
    if (!matched) return false;
    this._language.set(matched);
    return true;
  }

  setTenantContext(context: LocaleContextContract | null): void {
    this._tenantContext.set(context);
  }

  /**
   * The language to start in, before any session is known.
   *
   * Order: a previous explicit choice, then what the browser asks for, then the default. The
   * signed-in user's stored preference is deliberately NOT consulted here — it is applied by
   * `LanguageService` once the session resolves, because reading it here would require this store
   * to know about authentication and would reintroduce the dependency cycle this file exists to
   * avoid.
   */
  readInitialLanguage(): LanguageCode {
    if (!this.isBrowser) return DEFAULT_LANGUAGE;

    const stored = this.read(LANGUAGE_STORAGE_KEY);
    if (isLanguageCode(stored)) return stored;

    for (const tag of this.browserLanguages()) {
      const matched = matchLanguage(tag);
      if (matched) return matched;
    }
    return DEFAULT_LANGUAGE;
  }

  /** True when the visitor has made an explicit choice we are obliged to respect. */
  hasStoredChoice(): boolean {
    return isLanguageCode(this.read(LANGUAGE_STORAGE_KEY));
  }

  private browserLanguages(): readonly string[] {
    const navigatorRef = this.document.defaultView?.navigator;
    if (!navigatorRef) return [];
    // `languages` is the ordered preference list; `language` is only the first of it. Reading
    // both means a browser set to [fr, en, es] resolves to English rather than to the default.
    return navigatorRef.languages?.length ? navigatorRef.languages : [navigatorRef.language];
  }

  private browserTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  /**
   * Storage that cannot break the application.
   *
   * Safari in private mode, and any browser configured to block site data, throw on access rather
   * than returning null. A language preference is never worth a blank page.
   */
  private read(key: string): string | null {
    if (!this.isBrowser) return null;
    try {
      return this.document.defaultView?.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    if (!this.isBrowser) return;
    try {
      const storage = this.document.defaultView?.localStorage;
      if (!storage) return;
      storage.setItem(key, value);
      for (const legacy of LEGACY_STORAGE_KEYS) storage.removeItem(legacy);
    } catch {
      /* Blocked storage. The choice holds for this tab and is re-asked next visit. */
    }
  }
}
