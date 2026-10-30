import { Injectable, computed, inject } from '@angular/core';
import {
  DateOrder,
  DateSeparator,
  LanguageCode,
  LocaleTag,
  NUMBER_FORMAT_SYMBOLS,
  withNumberSymbols,
  writeNumericDate,
} from '@virteex/shared/types';
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
 * ## A fourth: what the company or the person chose
 *
 * `LocaleStore.regionalFormat` may override how a date is ordered and separated, which marks a
 * number groups and decimals with, and the clock. The locale still decides everything else — the
 * currency symbol and where it goes, month names, a negative's sign — and the override replaces
 * only the parts it names, through `formatToParts`, so a currency or a percentage gets the chosen
 * decimal comma without anyone re-implementing currency formatting. The same rules read typed
 * input back (`parseNumber`, `parseDate`), so a field never accepts one format and shows another.
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

  /** Invalidate the memo whenever the locale, the timezone or the chosen format changes. */
  private readonly cacheKey = computed(
    () => `${this.store.locale()}|${this.store.timezone()}|${JSON.stringify(this.store.regionalFormat())}`,
  );
  private lastCacheKey = '';

  /** The format in force: the person's over the company's. Absent fields follow the locale. */
  readonly regionalFormat = this.store.regionalFormat;

  /**
   * The thousands separator and the decimal mark in force: the chosen ones, or the locale's.
   * Read by number inputs to show and parse what the reader types.
   */
  readonly numberSymbols = computed<{ group: string; decimal: string }>(() => {
    const chosen = this.store.regionalFormat().numberFormat;
    if (chosen) return NUMBER_FORMAT_SYMBOLS[chosen];
    return localeNumberSymbols(this.store.locale());
  });

  /** The order and separator of a numeric date in force: the chosen ones, or the locale's. */
  readonly datePattern = computed<{ order: DateOrder; separator: DateSeparator | string }>(() => {
    const format = this.store.regionalFormat();
    const locale = localeDatePattern(this.store.locale());
    return { order: format.dateOrder ?? locale.order, separator: format.dateSeparator ?? locale.separator };
  });

  /** «dd/mm/aaaa», «mm/dd/yyyy»: what a date field asks for, in the reader's language. */
  datePlaceholder(letters: { day: string; month: string; year: string }): string {
    const { order, separator } = this.datePattern();
    return writeNumericDate({ day: letters.day.repeat(2), month: letters.month.repeat(2), year: letters.year.repeat(4) }, order, separator);
  }

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
    return this.formatNumber(this.numberFormatter({ ...this.digitOptions(digits) }), parsed);
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
    return this.formatNumber(
      this.numberFormatter({
        style: 'currency',
        currency,
        currencyDisplay: options.display ?? 'symbol',
        ...this.digitOptions(options.digits),
      }),
      parsed,
    );
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
    return this.formatNumber(
      this.numberFormatter({
        style: 'percent',
        ...this.digitOptions(digits ?? '1.0-2'),
      }),
      parsed,
    );
  }

  /** Compact form for dashboards: 1,2 M rather than 1.234.567. */
  compact(value: number | string | null | undefined): string {
    const parsed = this.toNumber(value);
    if (parsed === null) return '';
    return this.formatNumber(
      this.numberFormatter({
        notation: 'compact',
        maximumFractionDigits: 1,
      }),
      parsed,
    );
  }

  /**
   * A number as a field shows it while it is edited: the decimal mark in force, no grouping, no
   * trailing zeros invented. `1234.5` is «1234,5» with a decimal comma. Grouping is left out on
   * purpose: a separator that appears under the caret while someone types moves the caret.
   */
  numberForInput(value: number | string | null | undefined, maxFractionDigits = 10): string {
    const parsed = this.toNumber(value);
    if (parsed === null) return '';
    const text = parsed.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: maxFractionDigits });
    return text.replace('.', this.numberSymbols().decimal);
  }

  /**
   * What a person typed, read as a number — or `null` when it is not one.
   *
   * Reads the decimal mark in force. Grouping is tolerated (spaces, apostrophes, and the group
   * separator in force) because people paste figures from statements; the other mark is NOT
   * silently accepted as a decimal, because «1.234» means a thousand and something to a reader of
   * `1.234,56` and one point something to everyone else, and guessing between them is how a price
   * gets a thousandfold error. A second decimal mark, or a letter, is not a number.
   */
  parseNumber(text: string | null | undefined): number | null {
    return parseLocalizedNumber(text, this.numberSymbols());
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
    // A bare `YYYY-MM-DD` IS a calendar date — it carries no time and no zone, so there is nothing
    // to convert and converting it is the defect. Inferring that from the value rather than
    // requiring every call site to remember a flag is what makes this reliable: thirty-six call
    // sites rendered an accounting date without it, and each one showed the day before. An invoice
    // dated 2026-09-14 read 09/13/2026 in its list, on the document, and in the "what falls due"
    // panel; a balance sheet asked for `asOfDate=2026-09-14` and titled itself "As of 9/13/2026";
    // an income statement for the year titled itself "From 12/31/2025".
    const dateOnly = options.dateOnly === true || isCalendarDate(value);
    const parsed = this.toDate(value, dateOnly);
    if (!parsed) return '';
    const timeZone = dateOnly ? 'UTC' : this.store.timezone();
    const formatter = this.dateFormatter(preset, timeZone);
    if ((preset === 'date' || preset === 'dateTime') && this.dateOverridden()) {
      return this.numericDate(parsed, timeZone, preset === 'dateTime');
    }
    if (preset === 'dayMonth') {
      // A day and a month as prose writes them — «30 sept.», «Sep 30» — whatever joiner the
      // locale's numeric pattern uses: CLDR gives es-DO «d-MMM», which printed «30-sept» on the
      // home page (QA U20).
      return formatter
        .formatToParts(parsed)
        .map((part) => (part.type === 'literal' && part.value.trim() === '-' ? ' ' : part.value))
        .join('');
    }
    return formatter.format(parsed);
  }

  /** A calendar date (`YYYY-MM-DD`) as a date field shows it: «14/09/2026», «2026-09-14». */
  dateForInput(value: string | null | undefined): string {
    if (!value || !isCalendarDate(value)) return '';
    const [year, month, day] = value.split('-');
    return writeNumericDate({ day, month, year }, this.datePattern().order, this.datePattern().separator);
  }

  /**
   * A typed date read back as `YYYY-MM-DD`, or `null` when it is not a real date.
   *
   * Reads the order in force; accepts any of `/ - .` or a space between the parts, one- or two-digit
   * days and months, and a two-digit year as this century. An ISO date is accepted whatever the
   * order, because it cannot be misread. «31/02/2026» is not a date and is refused, not rolled
   * into March.
   */
  parseDate(text: string | null | undefined): string | null {
    return parseLocalizedDate(text, this.datePattern().order);
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

  /** Whether the date order or separator was chosen rather than left to the locale. */
  private dateOverridden(): boolean {
    const format = this.store.regionalFormat();
    return !!format.dateOrder || !!format.dateSeparator;
  }

  /** A numeric date in the order and with the separator in force; with the time when asked. */
  private numericDate(value: Date, timeZone: string, withTime: boolean): string {
    const parts = this.dateFormatter('date', timeZone).formatToParts(value);
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
    const { order, separator } = this.datePattern();
    const date = writeNumericDate({ day: pick('day'), month: pick('month'), year: pick('year') }, order, separator);
    return withTime ? `${date} ${this.dateFormatter('time', timeZone).format(value)}` : date;
  }

  /** The formatted number with the chosen group and decimal marks, when there are chosen ones. */
  private formatNumber(formatter: Intl.NumberFormat, value: number): string {
    const numberFormat = this.store.regionalFormat().numberFormat;
    // The common case formats directly: `formatToParts` per cell is measurable in a long ledger.
    return numberFormat ? withNumberSymbols(formatter.formatToParts(value), numberFormat) : formatter.format(value);
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
      const options: Intl.DateTimeFormatOptions = { ...DATE_PRESETS[preset], timeZone };
      // The clock chosen, for every preset that shows one. `hourCycle` rather than `hour12`: the
      // latter wins over the former and picks `h11` in some locales, «0:30 p. m.».
      const clock = this.store.regionalFormat().timeFormat;
      if (clock && (options.hour || options.timeStyle)) options.hourCycle = clock;
      formatter = new Intl.DateTimeFormat(locale, options);
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
 * Whether a value is a calendar date rather than an instant.
 *
 * Exactly `YYYY-MM-DD` and nothing after it. A full timestamp — `2026-09-14T00:00:00.000Z` — is
 * deliberately NOT treated as one even though it sits at midnight: it may be a genuine instant,
 * and guessing would move a real time by the offset. Columns that are calendar dates are serialised
 * as `YYYY-MM-DD`, which is what makes this unambiguous rather than a heuristic.
 */
export function isCalendarDate(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
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
  // «domingo, 11 de octubre»: the day spelled out reads as a sentence; «Domingo, 11 Oct» did not.
  weekday: { weekday: 'long', day: 'numeric', month: 'long' },
};

/** The group and decimal marks a locale writes, read from CLDR. */
export function localeNumberSymbols(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  return {
    group: parts.find((part) => part.type === 'group')?.value ?? '',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}

/** The order and separator of a locale's numeric date, read from CLDR. */
export function localeDatePattern(locale: string): { order: DateOrder; separator: string } {
  const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).formatToParts(
    new Date(Date.UTC(2026, 10, 25)),
  );
  const order = parts
    .filter((part) => part.type === 'day' || part.type === 'month' || part.type === 'year')
    .map((part) => (part.type === 'day' ? 'D' : part.type === 'month' ? 'M' : 'Y'))
    .join('');
  const separator = parts.find((part) => part.type === 'literal')?.value ?? '/';
  return { order: (['DMY', 'MDY', 'YMD'].includes(order) ? order : 'DMY') as DateOrder, separator };
}

/**
 * See `FormatService.parseNumber`. Pure, for the inputs and the tests.
 *
 * A group mark is accepted only where a group mark goes — every three digits of the integer part.
 * Stripping it wherever it appeared read «1,5» as fifteen for a reader of `1,234.56` who meant one
 * and a half; a mark in the wrong place is refused instead, and the field says so.
 */
export function parseLocalizedNumber(text: string | null | undefined, symbols: { group: string; decimal: string }): number | null {
  if (text === null || text === undefined) return null;
  let value = String(text).trim().replace(/^[−–]/, '-');
  if (value === '') return null;
  const decimal = symbols.decimal;
  const other = decimal === '.' ? ',' : '.';
  // Every mark that can group: spaces of every width, apostrophes, and the group mark in force.
  const groupMarks = new Set([' ', '\u00a0', '\u202f', "'", '’', ...(symbols.group && symbols.group !== decimal ? [symbols.group] : [])]);
  let normalised = '';
  for (const char of value) normalised += groupMarks.has(char) ? 'G' : char === decimal ? 'D' : char;
  // The other mark is neither a group mark in force nor the decimal: refusing beats guessing.
  if (normalised.includes(other)) return null;
  const match = /^([-+]?)(\d{1,3}(?:G\d{3})+|\d+)(?:D(\d*))?$|^([-+]?)D(\d+)$/.exec(normalised);
  if (!match) return null;
  value = match[5] !== undefined ? `${match[4]}0.${match[5]}` : `${match[1]}${match[2].replace(/G/g, '')}${match[3] ? `.${match[3]}` : ''}`;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** See `FormatService.parseDate`. Pure, for the inputs and the tests. */
export function parseLocalizedDate(text: string | null | undefined, order: DateOrder): string | null {
  if (text === null || text === undefined) return null;
  const value = String(text).trim();
  if (!value) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const parts = iso ? [iso[1], iso[2], iso[3]] : value.split(/[\/\-.\s]+/);
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const effective: DateOrder = iso ? 'YMD' : order;
  const at = (letter: 'D' | 'M' | 'Y') => parts[effective.indexOf(letter)];
  let year = Number(at('Y'));
  const month = Number(at('M'));
  const day = Number(at('D'));
  if (at('Y').length === 2) year += 2000;
  else if (at('Y').length !== 4) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Re-exported so callers can type a locale without importing the contract twice. */
export type { LocaleTag };
