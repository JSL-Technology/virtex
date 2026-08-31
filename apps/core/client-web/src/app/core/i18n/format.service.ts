import { Injectable, computed, inject } from '@angular/core';
import { LanguageCode, LocaleTag } from '@virteex/shared/types';
import { LocaleStore } from './locale.store';

/**
 * Every number, date and amount the interface shows.
 *
 * ## Why not Angular's own pipes
 *
 * `DatePipe`, `DecimalPipe` and `CurrencyPipe` read `LOCALE_ID`, which is a static injection token
 * fixed at bootstrap. It cannot change when the reader changes language, and it carries no
 * timezone at all. The application also never provided it, so every one of the 82 `| number` and
 * 21 `| date` usages in the templates rendered as `en-US` regardless of the language selected —
 * `1,234.56` and `Jan 5, 2026` to a reader in Bogotá.
 *
 * `Intl` has the full CLDR data in every runtime this product supports, changes with a signal,
 * and takes a timezone. It costs nothing at build time and is correct for locales nobody thought
 * to register.
 *
 * ## The three things that decide a format
 *
 * - **Locale** — the reader's language placed in the tenant's country (`LocaleStore.locale`).
 * - **Timezone** — the tenant's, never the reader's. See `LocaleStore.timezone`.
 * - **Currency** — carried by the amount itself. An ERP holds balances in several currencies at
 *   once; a formatter that assumes one is a formatter that will eventually print pesos with a
 *   dollar sign. `money()` requires the code, defaulting only to the tenant's functional currency
 *   when the caller genuinely has no better answer.
 *
 * Formatter construction is memoised: `Intl.NumberFormat` is expensive enough that building one
 * per cell in a ledger of ten thousand rows is measurable, and the arguments repeat.
 */
@Injectable({ providedIn: 'root' })
export class FormatService {
  private readonly store = inject(LocaleStore);

  readonly locale = this.store.locale;
  readonly timezone = this.store.timezone;

  private readonly numberFormatters = new Map<string, Intl.NumberFormat>();
  private readonly dateFormatters = new Map<string, Intl.DateTimeFormat>();
  private readonly relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
  private readonly pluralRules = new Map<string, Intl.PluralRules>();

  /** Invalidate the memo whenever the locale or timezone changes. */
  private readonly cacheKey = computed(() => `${this.store.locale()}|${this.store.timezone()}`);
  private lastCacheKey = '';

  // -------------------------------------------------------------------------
  // Numbers
  // -------------------------------------------------------------------------

  /**
   * A plain number.
   *
   * `digits` follows Angular's `DecimalPipe` grammar (`'1.2-2'`) so the templates that already
   * used it read the same after the migration and nobody has to relearn a format string.
   */
  number(value: number | string | null | undefined, digits?: string): string {
    const parsed = this.toNumber(value);
    if (parsed === null) return '';
    return this.numberFormatter({ ...this.digitOptions(digits) }).format(parsed);
  }

  /**
   * A monetary amount, in the currency the amount is actually in.
   *
   * `currencyCode` is the first argument and not an option because forgetting it is the error
   * this signature exists to prevent. When it is omitted the tenant's functional currency is
   * used, which is right for a balance in the tenant's own books and wrong for anything else —
   * so pass it whenever the record carries one.
   */
  money(
    value: number | string | null | undefined,
    currencyCode?: string | null,
    options: { display?: 'symbol' | 'code' | 'name'; digits?: string } = {},
  ): string {
    const parsed = this.toNumber(value);
    if (parsed === null) return '';
    const currency = (currencyCode || this.store.currency()).toUpperCase();
    return this.numberFormatter({
      style: 'currency',
      currency,
      currencyDisplay: options.display ?? 'symbol',
      ...this.digitOptions(options.digits),
    }).format(parsed);
  }

  /**
   * A ratio rendered as a percentage.
   *
   * Takes the ratio (0.075), not the percentage (7.5), matching `PercentPipe` — mixing the two
   * is a hundredfold error on a tax rate.
   */
  percent(value: number | string | null | undefined, digits?: string): string {
    const parsed = this.toNumber(value);
    if (parsed === null) return '';
    return this.numberFormatter({
      style: 'percent',
      ...this.digitOptions(digits ?? '1.0-2'),
    }).format(parsed);
  }

  /** Compact form for dashboards: 1,2 M rather than 1.234.567. */
  compact(value: number | string | null | undefined): string {
    const parsed = this.toNumber(value);
    if (parsed === null) return '';
    return this.numberFormatter({
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(parsed);
  }

  // -------------------------------------------------------------------------
  // Dates
  // -------------------------------------------------------------------------

  /**
   * A date or a timestamp, in the tenant's timezone.
   *
   * The named presets replace the format strings the templates carried (`'dd/MM/yyyy'`,
   * `'short'`, `'mediumDate'`). A named preset resolves through CLDR, so `'date'` is
   * `05/01/2026` in Santo Domingo and `1/5/2026` in Miami without anybody writing either.
   *
   * `dateOnly` exists because an accounting date is not an instant. A `2026-01-01` invoice date
   * has no time and no zone; converting it is what produced off-by-one dates. Pass `dateOnly`
   * for a column typed `date` in the database and the value is rendered exactly as stored.
   */
  date(
    value: Date | string | number | null | undefined,
    preset: DatePreset = 'date',
    options: { dateOnly?: boolean } = {},
  ): string {
    const parsed = this.toDate(value, options.dateOnly === true);
    if (!parsed) return '';
    const timeZone = options.dateOnly ? 'UTC' : this.store.timezone();
    return this.dateFormatter(preset, timeZone).format(parsed);
  }

  /**
   * "hace 5 minutos" / "5 minutes ago", chosen by CLDR rather than by an `if`.
   *
   * `numeric: 'auto'` is what produces "ayer" instead of "hace 1 día"; writing that rule by hand
   * per language is the thing this replaces.
   */
  relativeTime(value: Date | string | number | null | undefined): string {
    const parsed = this.toDate(value, false);
    if (!parsed) return '';

    const deltaMs = parsed.getTime() - Date.now();
    const absolute = Math.abs(deltaMs);
    const formatter = this.relativeFormatter();

    const MINUTE = 60_000;
    const HOUR = 3_600_000;
    const DAY = 86_400_000;
    const WEEK = 604_800_000;
    const MONTH = 2_629_746_000; // mean Gregorian month
    const YEAR = 31_556_952_000;

    if (absolute < MINUTE) return formatter.format(Math.round(deltaMs / 1000), 'second');
    if (absolute < HOUR) return formatter.format(Math.round(deltaMs / MINUTE), 'minute');
    if (absolute < DAY) return formatter.format(Math.round(deltaMs / HOUR), 'hour');
    if (absolute < WEEK) return formatter.format(Math.round(deltaMs / DAY), 'day');
    if (absolute < MONTH) return formatter.format(Math.round(deltaMs / WEEK), 'week');
    if (absolute < YEAR) return formatter.format(Math.round(deltaMs / MONTH), 'month');
    return formatter.format(Math.round(deltaMs / YEAR), 'year');
  }

  // -------------------------------------------------------------------------
  // Plurals and lists
  // -------------------------------------------------------------------------

  /**
   * The CLDR plural category for a count, in the current language.
   *
   * Used by the translate pipe's plural helper so a catalogue can carry `_one` / `_other` (and
   * `_many` where a language has one) instead of a ternary in a template. Spanish and English
   * have two forms, Portuguese two, but the categories are not the same set and the boundaries
   * differ — `1.5` is `other` in English and `one` in Portuguese. Hand-written pluralisation gets
   * this wrong in exactly the cases nobody tests.
   */
  pluralCategory(count: number, language?: LanguageCode): Intl.LDMLPluralRule {
    const locale = language ?? this.store.locale();
    const key = `plural|${locale}`;
    let rules = this.pluralRules.get(key);
    if (!rules) {
      rules = new Intl.PluralRules(locale);
      this.pluralRules.set(key, rules);
    }
    return rules.select(count);
  }

  /** "a, b y c" / "a, b and c" — the conjunction and the serial comma come from CLDR. */
  list(items: readonly string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
    const clean = items.filter((item) => typeof item === 'string' && item.length > 0);
    if (clean.length === 0) return '';
    return new Intl.ListFormat(this.store.locale(), { style: 'long', type }).format(clean);
  }

  /** Locale-aware comparison for sorting names: `ñ` after `n`, `ä` with `a`, case-insensitive. */
  comparator(): (a: string, b: string) => number {
    const collator = new Intl.Collator(this.store.locale(), {
      sensitivity: 'base',
      numeric: true,
    });
    return (a, b) => collator.compare(a ?? '', b ?? '');
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private evictIfStale(): void {
    const key = this.cacheKey();
    if (key === this.lastCacheKey) return;
    this.lastCacheKey = key;
    this.numberFormatters.clear();
    this.dateFormatters.clear();
    this.relativeFormatters.clear();
    this.pluralRules.clear();
  }

  private numberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
    this.evictIfStale();
    const locale = this.store.locale();
    const key = `${locale}|${JSON.stringify(options)}`;
    let formatter = this.numberFormatters.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, options);
      this.numberFormatters.set(key, formatter);
    }
    return formatter;
  }

  private dateFormatter(preset: DatePreset, timeZone: string): Intl.DateTimeFormat {
    this.evictIfStale();
    const locale = this.store.locale();
    const key = `${locale}|${preset}|${timeZone}`;
    let formatter = this.dateFormatters.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, { ...DATE_PRESETS[preset], timeZone });
      this.dateFormatters.set(key, formatter);
    }
    return formatter;
  }

  private relativeFormatter(): Intl.RelativeTimeFormat {
    this.evictIfStale();
    const locale = this.store.locale();
    let formatter = this.relativeFormatters.get(locale);
    if (!formatter) {
      formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      this.relativeFormatters.set(locale, formatter);
    }
    return formatter;
  }

  /**
   * Angular's `'1.2-2'` digit grammar: minimum integer, then minimum and maximum fraction digits.
   *
   * Reproduced rather than dropped so the migration from `| number: '1.2-2'` is mechanical. An
   * unparseable string is ignored instead of throwing: a bad format string in one cell must not
   * take down the page that renders ten thousand of them.
   */
  private digitOptions(digits?: string): Intl.NumberFormatOptions {
    if (!digits) return {};
    const match = /^(\d+)\.(\d+)-(\d+)$/.exec(digits.trim());
    if (!match) return {};
    const [, integer, minFraction, maxFraction] = match;
    const minimumFractionDigits = Number(minFraction);
    const maximumFractionDigits = Number(maxFraction);
    return {
      minimumIntegerDigits: Number(integer),
      minimumFractionDigits,
      // `Intl` throws when the maximum is below the minimum; Angular silently clamped. Clamping
      // keeps a malformed format string from becoming a runtime exception.
      maximumFractionDigits: Math.max(minimumFractionDigits, maximumFractionDigits),
    };
  }

  private toNumber(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    // Money arrives from the API as a string more often than not: TypeORM returns `numeric`
    // columns as strings precisely so that a 19-digit balance is not silently rounded by a
    // double. Accepting both is what keeps the ledger from rendering blanks.
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * @param dateOnly treat a bare `YYYY-MM-DD` as a calendar date with no zone, not as midnight UTC
   *                 converted into the reader's zone.
   */
  private toDate(value: Date | string | number | null | undefined, dateOnly: boolean): Date | null {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

    if (typeof value === 'string' && dateOnly) {
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      if (match) {
        // Built in UTC and rendered in UTC, so the calendar date survives untouched.
        return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      }
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}

/**
 * The date shapes this product shows, named by intent rather than by pattern.
 *
 * A template asks for `'date'` or `'dateTime'`; which of `dd/MM/yyyy` or `MM/dd/yyyy` that is
 * belongs to CLDR, not to the template. That is the whole point: `'dd/MM/yyyy'` written into a
 * template is a decision that a Miami reader never agreed to.
 */
export type DatePreset =
  | 'date'
  | 'dateLong'
  | 'dateTime'
  | 'dateTimeLong'
  | 'time'
  | 'monthYear'
  | 'dayMonth'
  | 'weekday';

const DATE_PRESETS: Readonly<Record<DatePreset, Intl.DateTimeFormatOptions>> = {
  date: { year: 'numeric', month: '2-digit', day: '2-digit' },
  dateLong: { year: 'numeric', month: 'long', day: 'numeric' },
  dateTime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
  dateTimeLong: { dateStyle: 'long', timeStyle: 'short' },
  time: { hour: '2-digit', minute: '2-digit' },
  monthYear: { year: 'numeric', month: 'long' },
  dayMonth: { day: '2-digit', month: 'short' },
  weekday: { weekday: 'long', day: '2-digit', month: 'short' },
};

/** Re-exported so callers can type a locale without importing the contract twice. */
export type { LocaleTag };
