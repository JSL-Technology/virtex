import { Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_LANGUAGE,
  LanguageCode,
  SUPPORTED_LANGUAGES,
  isLanguageCode,
} from '@virteex/shared/types';

import es from './messages/es.json';
import en from './messages/en.json';
import pt from './messages/pt.json';

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

type Catalogue = Record<string, unknown>;

const CATALOGUES: Readonly<Record<LanguageCode, Catalogue>> = {
  es: es as Catalogue,
  en: en as Catalogue,
  pt: pt as Catalogue,
};

@Injectable()
export class I18nService {
  private readonly logger = new Logger(I18nService.name);

  /** Flattened lookup per language, built once at construction. */
  private readonly tables: Record<LanguageCode, Map<string, string>>;

  /** Keys already reported missing, so a hot path logs once rather than per request. */
  private readonly reportedMissing = new Set<string>();

  constructor() {
    this.tables = Object.fromEntries(
      SUPPORTED_LANGUAGES.map((language) => [language, flatten(CATALOGUES[language])]),
    ) as Record<LanguageCode, Map<string, string>>;
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
  ): string {
    const resolvedKey = this.applyPlural(key, language, params);
    const template =
      this.tables[language]?.get(resolvedKey) ??
      this.tables[DEFAULT_LANGUAGE].get(resolvedKey) ??
      this.tables[language]?.get(key) ??
      this.tables[DEFAULT_LANGUAGE].get(key);

    if (template === undefined) {
      if (!this.reportedMissing.has(key)) {
        this.reportedMissing.add(key);
        this.logger.warn(`Missing server translation: "${key}"`);
      }
      return key;
    }

    return interpolate(template, params);
  }

  /** True when the key exists in any catalogue — used by the exception filter to tell a key from a sentence. */
  has(key: string): boolean {
    return this.tables[DEFAULT_LANGUAGE].has(key) || this.hasPluralForms(key);
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

/** `{ A: { B: 'x' } }` becomes `'A.B' -> 'x'`. */
function flatten(tree: Catalogue, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value as Catalogue, path, out);
    } else {
      out.set(path, String(value));
    }
  }
  return out;
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

export { flatten as flattenCatalogue, interpolate as interpolateMessage, isLanguageCode };
