import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_LANGUAGE,
  LanguageCode,
  LocaleTag,
  NEUTRAL_LOCALE,
  SUPPORTED_LANGUAGES,
  isLanguageCode,
  normalizeKey,
} from '@virteex/shared/types';

import { currentLanguage, currentLocaleContext } from './request-locale';

import es from './messages/es.json';
import en from './messages/en.json';
import pt from './messages/pt.json';
import regional from './messages/regional.json';

/**
 * The server's message catalogue.
 *
 * ## Why the server needs one at all
 *
 * It had none — not a catalogue, not a dependency, not a single reference to `Accept-Language`
 * anywhere in 629 files. What it had was 197 exception messages written as Spanish literals
 * (`'El asiento contable no está balanceado.'`, `'No puedes desactivar o bloquear tu propia
 * cuenta.'`) which the client then displayed verbatim. The interface was translated; the moment
 * anything went wrong, it was not. The same applies to every transactional e-mail, every invoice
 * PDF and every dunning notice.
 *
 * A translated interface with untranslated failure states is not a translated product. The
 * failure states are disproportionately where a customer needs to understand what happened.
 *
 * ## Shape
 *
 * Flat dotted keys, resolved against nested JSON — the same convention and the same files' shape
 * as the client, so a developer moving between them is not learning two systems. Interpolation
 * is `{{name}}`. Pluralisation is CLDR, via `Intl.PluralRules`, by suffixing the key with the
 * category (`_one`, `_other`, `_many`) — which is why "1 minuto / 2 minutos" is no longer a
 * ternary written into TypeScript, where it was both Spanish-only and wrong for `1.5`.
 */

type Catalogue = Record<string, string>;

const CATALOGUES: Readonly<Record<LanguageCode, Catalogue>> = {
  es: es as Catalogue,
  en: en as Catalogue,
  pt: pt as Catalogue,
};

/**
 * Per-country wording, keyed by locale tag.
 *
 * Only the entries that actually differ from the neutral catalogue, which for the server is a
 * handful: the tax identifier a filing calls for, and the name the payroll run has in each market.
 * A message rendered for a tenant reads that tenant's words — an invoice PDF for a Dominican
 * company says RNC, the same PDF for a Mexican one says RFC, from one template and one key.
 */
const REGIONAL: Readonly<Record<string, Catalogue>> = regional as Record<string, Catalogue>;

@Injectable()
export class I18nService {
  private readonly logger = new Logger(I18nService.name);

  /** Lookup per language, built once at construction. */
  private readonly tables: Record<LanguageCode, Map<string, string>>;

  /** Per-locale overrides, built once at construction. */
  private readonly regionalTables: Record<string, Map<string, string>>;

  /** Normalised spellings, memoised: the same composed key arrives on every row of a report. */
  private readonly normalizedKeys = new Map<string, string>();

  /** Keys already reported missing, so a hot path logs once rather than per request. */
  private readonly reportedMissing = new Set<string>();

  constructor() {
    this.tables = Object.fromEntries(
      SUPPORTED_LANGUAGES.map((language) => [language, new Map(Object.entries(CATALOGUES[language]))]),
    ) as Record<LanguageCode, Map<string, string>>;

    this.regionalTables = Object.fromEntries(
      Object.entries(REGIONAL).map(([locale, patch]) => [locale, new Map(Object.entries(patch))]),
    );
  }

  /**
   * Translate one key.
   *
   * Falls back to {@link DEFAULT_LANGUAGE} and then to the key itself. A key reaching the wire
   * unresolved is a defect, so it is logged once — but it is never allowed to throw: a missing
   * translation must not turn a 404 into a 500.
   */
  translate(
    key: string,
    language: LanguageCode = DEFAULT_LANGUAGE,
    params: Record<string, unknown> = {},
    options: { locale?: LocaleTag } = {},
  ): string {
    const canonical = this.canonical(key);
    const resolvedKey = this.applyPlural(canonical, language, params);
    const locale = options.locale;

    const template =
      this.regional(locale, resolvedKey) ??
      this.regional(locale, canonical) ??
      this.tables[language]?.get(resolvedKey) ??
      this.tables[DEFAULT_LANGUAGE].get(resolvedKey) ??
      this.tables[language]?.get(canonical) ??
      this.tables[DEFAULT_LANGUAGE].get(canonical);

    if (template === undefined) {
      if (!this.reportedMissing.has(canonical)) {
        this.reportedMissing.add(canonical);
        this.logger.warn(`Missing server translation: "${canonical}"`);
      }
      return key;
    }

    return interpolate(template, this.formatParams(params, language, options.locale));
  }

  /**
   * Prepare parameter values for a message.
   *
   * Three conventions, each of which exists because the alternative is worse:
   *
   * 1. **A value that is itself a catalogue key is translated.** `{{resource}}` receiving
   *    `'saas.resources.invoices'` renders "facturas"/"invoices"/"faturas". Without this, a
   *    notification about a quota would have to build its noun in the emitter — where the
   *    reader's language is not known — which is how the listener ended up with a table of
   *    Spanish literals in it.
   *
   * 2. **`amount` beside `currency` is formatted as money.** An unformatted `1234.5` in a dunning
   *    notice is not a figure a customer can check against their statement, and formatting it at
   *    the emitter would pin every recipient to one locale.
   *
   * 3. **An ISO-8601 timestamp is formatted as a date.** `2026-03-01T00:00:00.000Z` is not a
   *    date to anybody; `1 de marzo de 2026` is.
   *
   * Everything else passes through untouched. The conventions are keyed on the SHAPE of the
   * value, never on guesswork about the name alone, so a parameter that happens to be called
   * `amount` and holds a string is left exactly as it is.
   */
  private formatParams(
    params: Record<string, unknown>,
    language: LanguageCode,
    locale?: LocaleTag,
  ): Record<string, unknown> {
    const target = locale ?? NEUTRAL_LOCALE[language];
    const currency = typeof params['currency'] === 'string' ? params['currency'] : null;
    const out: Record<string, unknown> = {};

    for (const [name, value] of Object.entries(params)) {
      if (typeof value === 'string' && KEY_SHAPE.test(value) && this.has(value)) {
        out[name] = this.translate(value, language, {}, { locale });
        continue;
      }

      if (typeof value === 'number' && (name === 'amount' || name.endsWith('Amount')) && currency) {
        out[name] = formatMoney(value, currency, target);
        continue;
      }

      if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) {
        out[name] = formatDate(value, target);
        continue;
      }

      out[name] = value;
    }
    return out;
  }

  /**
   * Translate one key in the CURRENT REQUEST's language.
   *
   * `translate` takes the language explicitly because a background job — a dunning e-mail, a
   * scheduled report — has no request and must name the recipient's language itself. Inside a
   * request that argument is always the same value, and threading it through every service
   * signature to say so is how a codebase ends up with `language` on two hundred methods and one
   * of them forgetting it.
   *
   * The middleware has already resolved the language into `AsyncLocalStorage`, so this reads it
   * from there. Outside a request it degrades to {@link DEFAULT_LANGUAGE} rather than throwing:
   * a message in the wrong language is a defect, a crash in a worker is an outage.
   */
  t(key: string, params: Record<string, unknown> = {}): string {
    return this.translate(key, currentLanguage(), params, {
      locale: currentLocaleContext()?.locale,
    });
  }

  /** True when the key exists in any catalogue — used by the exception filter to tell a key from a sentence. */
  has(key: string): boolean {
    const canonical = this.canonical(key);
    return this.tables[DEFAULT_LANGUAGE].has(canonical) || this.hasPluralForms(canonical);
  }

  /**
   * The catalogue's spelling of a key a caller composed from data.
   *
   * A key built as `composeKey('permissions.groups', group)` already arrives normalised, but a key
   * assembled by string concatenation from a TypeORM enum arrives as
   * `accounts_payable.status.PARTIALLY_PAID`. Normalising here means a call site can spell a key
   * the way its data spells it, and the same reconciliation happens on the client in
   * `VirtexTranslateStore` — one rule, both runtimes.
   */
  private canonical(key: string): string {
    let normal = this.normalizedKeys.get(key);
    if (normal === undefined) {
      normal = normalizeKey(key);
      this.normalizedKeys.set(key, normal);
    }
    return normal;
  }

  /** The country's own wording for a key, when the caller said which country. */
  private regional(locale: LocaleTag | undefined, key: string): string | undefined {
    if (!locale) return undefined;
    return this.regionalTables[locale]?.get(key);
  }

  /** Every key in the default catalogue. The parity spec walks this. */
  keys(language: LanguageCode = DEFAULT_LANGUAGE): readonly string[] {
    return [...(this.tables[language]?.keys() ?? [])];
  }

  /**
   * Append the CLDR plural category when the caller passed a `count`.
   *
   * `INVOICE.OVERDUE_DAYS` with `{ count: 1 }` looks for `INVOICE.OVERDUE_DAYS_one` first, then
   * falls back to the bare key. Which categories a language has is CLDR's business: Spanish and
   * English have `one`/`other`, Portuguese has `one`/`many`/`other`, and `1.5` is `other` in
   * English but `one` in Portuguese — the class of detail that hand-written pluralisation gets
   * wrong in exactly the cases nobody writes a test for.
   */
  private applyPlural(
    key: string,
    language: LanguageCode,
    params: Record<string, unknown>,
  ): string {
    const count = params['count'];
    if (typeof count !== 'number' || !Number.isFinite(count)) return key;

    const category = new Intl.PluralRules(language).select(count);
    const candidate = `${key}_${category}`;
    if (this.tables[language]?.has(candidate)) return candidate;

    const fallback = `${key}_other`;
    return this.tables[language]?.has(fallback) ? fallback : key;
  }

  private hasPluralForms(key: string): boolean {
    const table = this.tables[DEFAULT_LANGUAGE];
    for (const suffix of ['_zero', '_one', '_two', '_few', '_many', '_other']) {
      if (table.has(`${key}${suffix}`)) return true;
    }
    return false;
  }
}

/**
 * A value shaped like a catalogue key, so it can be resolved rather than printed.
 *
 * Two segments at least: a bare word is a word. `this.has()` decides in the end, so the shape test
 * only has to be cheap enough to skip the lookup for the parameters that are plainly prose — which
 * is almost all of them.
 */
const KEY_SHAPE = /^[a-z0-9][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

/** An ISO-8601 instant, which is never something to show a reader as-is. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    // An unrecognised ISO code must not blank the figure a customer is being asked to pay.
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string, locale: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  // UTC: a server-side render has no reader timezone, and guessing one is how a due date moves.
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(parsed);
}

/**
 * `{{name}}` substitution.
 *
 * A placeholder with no matching parameter is left in place rather than replaced with `undefined`
 * — a visible `{{email}}` in a message is a bug report; the word "undefined" in the middle of a
 * sentence is a mystery. `translation-parity.spec` refuses to let the two languages disagree
 * about which placeholders a message has, so this is a last resort rather than a routine path.
 */
function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export { interpolate as interpolateMessage, isLanguageCode };
