/**
 * THE definition of what languages and regions this product speaks.
 *
 * ## Why this file exists
 *
 * The list of supported languages was written out nine times — in `LanguageService`, in
 * `languageInitGuard`, in `app.routes.ts`, inside `AuthService.logout`, in the auth footer, in
 * two `<select>` elements, in `FrontendUrlService` and in `InviteUserDto` — and the two DTOs did
 * not even agree with each other: an invitation accepted only `en`/`es` while a profile update
 * accepted any BCP-47 tag at all, so `fr-FR` could be stored for a user the client could never
 * render. Adding a language meant finding all nine, and forgetting one produced a silent
 * fallback rather than an error.
 *
 * Everything below is the single source both applications import.
 *
 * ## The three languages a business document has
 *
 * An ERP sold across a continent cannot have "the" language. A US-based controller working in a
 * Dominican subsidiary needs the interface in English, the chart of accounts in Spanish (those
 * are the statutory books, and the DGII reads them), and an invoice issued to a Brazilian
 * customer in Portuguese. Those are three independent decisions and the product models them as
 * three independent fields — see {@link LanguageAxis}. Collapsing them into one setting is the
 * mistake that makes a system like this untranslatable later.
 */

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/**
 * Interface languages with a complete, CI-verified message catalogue.
 *
 * A code only belongs here once `apps/core/client-web/src/assets/i18n/<code>.json` and
 * `apps/backend/api/src/app/i18n/messages/<code>.json` both exist and pass the parity specs.
 * The list is intentionally short: a half-translated language is worse than an absent one,
 * because the fallback hides it.
 */
export const SUPPORTED_LANGUAGES = ['es', 'en', 'pt'] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * The language used when nothing better is known.
 *
 * Spanish, because it is the language of every market in the launch set except the United
 * States and Brazil, both of which are detected rather than assumed.
 */
export const DEFAULT_LANGUAGE: LanguageCode = 'es';

/** Endonyms — a language is always offered in its own language, never translated. */
export const LANGUAGE_ENDONYMS: Readonly<Record<LanguageCode, string>> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
};

/** Writing direction. Declared per language so adding an RTL market is a data change. */
export const LANGUAGE_DIRECTION: Readonly<Record<LanguageCode, 'ltr' | 'rtl'>> = {
  es: 'ltr',
  en: 'ltr',
  pt: 'ltr',
};

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Regional formatting locales
// ---------------------------------------------------------------------------

/**
 * The regional locale used for FORMATTING — dates, numbers, currency, sorting, plural forms.
 *
 * Distinct from {@link LanguageCode} on purpose. `es-DO` and `es-AR` are the same catalogue and
 * different formats: 1.234,56 in Buenos Aires and 1,234.56 in Santo Domingo, `dd/MM/yyyy` in
 * both but `MM/dd/yyyy` for the same English catalogue in Miami. Treating "language" and
 * "number format" as one value is what produces an invoice that reads `1,234.56` to a reader
 * who parses it as one thousand two hundred.
 *
 * Formatting goes through `Intl`, which carries the full CLDR data in every supported runtime,
 * so this list costs nothing at build time and can grow to any market without a bundle change.
 */
export const SUPPORTED_LOCALES = [
  // Spanish
  'es-DO', 'es-MX', 'es-CO', 'es-CL', 'es-PE', 'es-AR', 'es-EC', 'es-UY',
  'es-PY', 'es-BO', 'es-VE', 'es-PA', 'es-CR', 'es-GT', 'es-SV', 'es-HN',
  'es-NI', 'es-US', 'es-419',
  // English
  'en-US', 'en-CA', 'en-GB',
  // Portuguese
  'pt-BR', 'pt-PT',
] as const;

export type LocaleTag = (typeof SUPPORTED_LOCALES)[number];

/** The formatting locale used when the tenant's country is unknown. */
export const DEFAULT_LOCALE: LocaleTag = 'es-419';

/** The neutral regional locale for each language, used when no country is known. */
export const NEUTRAL_LOCALE: Readonly<Record<LanguageCode, LocaleTag>> = {
  es: 'es-419',
  en: 'en-US',
  pt: 'pt-BR',
};

export function isLocaleTag(value: unknown): value is LocaleTag {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** The catalogue a formatting locale reads from. `pt-BR` → `pt`. */
export function languageOfLocale(locale: string): LanguageCode {
  const base = locale.slice(0, 2).toLowerCase();
  return isLanguageCode(base) ? base : DEFAULT_LANGUAGE;
}

// ---------------------------------------------------------------------------
// Negotiation
// ---------------------------------------------------------------------------

/**
 * Resolve an arbitrary language tag to a catalogue this product actually has.
 *
 * Accepts anything a browser, an `Accept-Language` header or a stored preference might hold:
 * `pt-BR`, `PT_br`, `es-419`, `zh-Hant-TW`. Returns `null` rather than a default when nothing
 * matches, so the caller decides what "unknown" means in its own context — a header falling
 * through to the next candidate is not the same as a stored preference being invalid.
 */
export function matchLanguage(tag: string | null | undefined): LanguageCode | null {
  if (typeof tag !== 'string') return null;
  const base = tag.trim().replace('_', '-').split('-')[0]?.toLowerCase();
  return isLanguageCode(base) ? base : null;
}

/**
 * Pick the best supported language from an `Accept-Language` header.
 *
 * Implements the quality-value ordering of RFC 9110 §12.5.4, including `q=0` as an explicit
 * refusal, and honours the wildcard. Returns `null` when the header expresses no preference this
 * product can satisfy — the caller then falls back to the tenant or the default, in that order.
 *
 *     negotiateLanguage('fr-CA,fr;q=0.9,en;q=0.8')  → 'en'
 *     negotiateLanguage('es-DO,es;q=0.9')           → 'es'
 *     negotiateLanguage('de,es;q=0')                → null   (Spanish explicitly refused)
 *     negotiateLanguage('*')                        → 'es'   (the default, via the wildcard)
 *     negotiateLanguage('en;q=oops')                → null   (unparseable priority, entry dropped)
 */
export function negotiateLanguage(header: string | null | undefined): LanguageCode | null {
  if (typeof header !== 'string' || !header.trim()) return null;

  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => /^\s*q\s*=/i.test(p));

      // A `q` that cannot be parsed makes the entry's priority unknowable. Assuming 1 promotes it
      // above languages the reader ranked explicitly; assuming 0 turns a typo into a refusal.
      // Both invent an intention. The entry is dropped instead, and if that empties the header the
      // caller falls back — which is the one outcome that cannot be wrong about what was meant.
      let quality = 1;
      if (qParam !== undefined) {
        const parsed = /^\s*q\s*=\s*(\d+(?:\.\d+)?)\s*$/i.exec(qParam);
        if (!parsed) return null;
        quality = Number.parseFloat(parsed[1]);
        if (!Number.isFinite(quality) || quality > 1) return null;
      }

      return { tag: (tag ?? '').trim(), quality };
    })
    .filter((c): c is { tag: string; quality: number } => c !== null && c.tag.length > 0)
    // A stable sort by descending quality preserves header order within a quality band, which is
    // what the specification means by "in order of preference".
    .sort((a, b) => b.quality - a.quality);

  const refused = new Set<LanguageCode>();
  for (const candidate of candidates) {
    if (candidate.quality > 0) continue;
    const language = candidate.tag === '*' ? null : matchLanguage(candidate.tag);
    if (language) refused.add(language);
  }

  for (const candidate of candidates) {
    if (candidate.quality <= 0) continue;
    if (candidate.tag === '*') {
      return refused.has(DEFAULT_LANGUAGE) ? null : DEFAULT_LANGUAGE;
    }
    const language = matchLanguage(candidate.tag);
    if (language && !refused.has(language)) return language;
  }

  return null;
}

/**
 * Build the formatting locale from a language and a country.
 *
 * Falls back to the language's neutral locale when the pair is not one this product formats for,
 * which keeps an unexpected country from producing an `Intl` locale nobody validated.
 */
export function resolveLocale(
  language: LanguageCode,
  countryCode?: string | null,
): LocaleTag {
  const country = (countryCode ?? '').trim().toUpperCase();
  const candidate = `${language}-${country}`;
  return isLocaleTag(candidate) ? candidate : NEUTRAL_LOCALE[language];
}

// ---------------------------------------------------------------------------
// The three axes
// ---------------------------------------------------------------------------

/**
 * Which language a given piece of text follows.
 *
 * Named so that every call site has to say which one it means. A function that takes a bare
 * `language: string` is the bug: it will eventually be handed the wrong one of these three.
 */
export enum LanguageAxis {
  /**
   * What the person reading the screen chose. Resolution order:
   * stored user preference → `Accept-Language` → tenant default → {@link DEFAULT_LANGUAGE}.
   */
  Interface = 'interface',

  /**
   * The tenant's statutory language, fixed when the organization is provisioned and derived
   * from its country. Account names, fiscal document type names and anything that appears in a
   * filing follow this and must NOT follow the reader: an auditor asking for the ledger expects
   * the names the books were opened with.
   */
  Books = 'books',

  /**
   * The language of an outbound document — an invoice PDF, a statement, a dunning e-mail.
   * Follows the recipient (the customer's own preference), falling back to the tenant's books
   * language. A Dominican company invoicing a Brazilian customer sends Portuguese.
   */
  Document = 'document',
}

/**
 * Everything the client needs to format a value correctly, resolved server-side.
 *
 * Sent with the session rather than inferred in the browser: the browser knows its own timezone
 * and locale, neither of which is the tenant's, and an accounting date rendered in the reader's
 * timezone is off by a day for half the continent.
 */
export interface LocaleContextContract {
  /** The catalogue the interface renders from. */
  language: LanguageCode;
  /** Regional locale for dates, numbers and sorting. */
  locale: LocaleTag;
  /** Writing direction of {@link language}. */
  direction: 'ltr' | 'rtl';
  /** ISO 3166-1 alpha-2 of the tenant. */
  countryCode: string;
  /** ISO 4217 of the tenant's functional currency — the default for amounts with no own code. */
  currency: string;
  /** IANA timezone of the tenant. Accounting dates are rendered in this, never in the browser's. */
  timezone: string;
  /** The tenant's statutory language — see {@link LanguageAxis.Books}. */
  booksLanguage: LanguageCode;
  /** First day of the week for calendars, 0 = Sunday. */
  firstDayOfWeek: number;
}
