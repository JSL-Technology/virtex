/**
 * How dates, numbers and times are WRITTEN, when somebody wants it different from what their
 * locale says.
 *
 * ## Why this exists
 *
 * The formats came from CLDR alone: the reader's language placed in the company's country. That
 * is the right default and the wrong ceiling. A Dominican company whose accountant was trained in
 * the United States reads `1,234.56` and `MM/DD/YYYY` every day of their working life; a group
 * that reports to a Spanish parent wants `1.234,56` in every subsidiary; somebody who exports to a
 * spreadsheet wants ISO dates. None of them could say so: every number was `es-DO`'s.
 *
 * ## Two levels, field by field
 *
 * The company sets a default for everyone (`organization_settings.regional_format`) and each
 * person may override it for themselves (`users.regional_format`). Each field resolves on its own:
 * a person who only wants a 24-hour clock keeps the company's decimal comma. An absent or `null`
 * field means «automatic»: the next level decides, and at the bottom the locale does.
 *
 * ## What it changes, and what it deliberately does not
 *
 * It changes how a value is shown and how a typed value is read — the same rule in both
 * directions, so a field never accepts `1.234,56` and then shows `1,234.56`. It does not change
 * the value: the API, the database and every export keep speaking ISO dates and plain decimals.
 * And it does not touch dates written in words («30 de septiembre de 2026»): their order is
 * grammar, not preference.
 */

/** The order of day, month and year in a date written with numbers. */
export const DATE_ORDERS = ['DMY', 'MDY', 'YMD'] as const;
export type DateOrder = (typeof DATE_ORDERS)[number];

/** What goes between the day, the month and the year. */
export const DATE_SEPARATORS = ['/', '-', '.'] as const;
export type DateSeparator = (typeof DATE_SEPARATORS)[number];

/**
 * The thousands separator and the decimal mark, as one choice.
 *
 * One choice and not two because they are not independent: a comma cannot be both, and the
 * combinations people actually use are these. Named by what they look like, so a stored value
 * reads as what it means.
 */
export const NUMBER_FORMATS = ['comma_dot', 'dot_comma', 'space_comma', 'space_dot', 'apostrophe_dot', 'none_dot', 'none_comma'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

/** The symbols each number format writes. `group` is a narrow no-break space where it is a space. */
export const NUMBER_FORMAT_SYMBOLS: Readonly<Record<NumberFormat, { group: string; decimal: string }>> = {
  comma_dot: { group: ',', decimal: '.' },
  dot_comma: { group: '.', decimal: ',' },
  space_comma: { group: ' ', decimal: ',' },
  space_dot: { group: ' ', decimal: '.' },
  apostrophe_dot: { group: '’', decimal: '.' },
  none_dot: { group: '', decimal: '.' },
  none_comma: { group: '', decimal: ',' },
};

/** A 24-hour clock (`h23`, 14:30) or a 12-hour one (`h12`, 2:30 p. m.). */
export const TIME_FORMATS = ['h23', 'h12'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

/** The day calendars start on: Sunday, Monday or Saturday. */
export const WEEK_STARTS = [0, 1, 6] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];

/** One level's choices. Every field is optional: absent or `null` is «automatic». */
export interface RegionalFormat {
  dateOrder?: DateOrder | null;
  dateSeparator?: DateSeparator | null;
  numberFormat?: NumberFormat | null;
  timeFormat?: TimeFormat | null;
  firstDayOfWeek?: WeekStart | null;
}

/** The fields of {@link RegionalFormat}, for code that walks them. */
export const REGIONAL_FORMAT_FIELDS = ['dateOrder', 'dateSeparator', 'numberFormat', 'timeFormat', 'firstDayOfWeek'] as const;
export type RegionalFormatField = (typeof REGIONAL_FORMAT_FIELDS)[number];

const ALLOWED: { readonly [F in RegionalFormatField]: readonly unknown[] } = {
  dateOrder: DATE_ORDERS,
  dateSeparator: DATE_SEPARATORS,
  numberFormat: NUMBER_FORMATS,
  timeFormat: TIME_FORMATS,
  firstDayOfWeek: WEEK_STARTS,
};

/** Whether a value is one this field accepts. `null` is accepted everywhere: it means automatic. */
export function isRegionalFormatValue(field: RegionalFormatField, value: unknown): boolean {
  return value === null || ALLOWED[field].includes(value);
}

/**
 * The stored shape, cleaned: unknown fields dropped, unknown values dropped, `null` kept out.
 *
 * Read on the way in and on the way out. A value written by an older or newer build, or by hand in
 * the database, falls back to automatic instead of reaching a formatter that would throw on it.
 */
export function normaliseRegionalFormat(input: unknown): RegionalFormat {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of REGIONAL_FORMAT_FIELDS) {
    const value = source[field];
    if (value !== null && value !== undefined && ALLOWED[field].includes(value)) out[field] = value;
  }
  return out as RegionalFormat;
}

/**
 * Field by field, the first level that decided: the person over the company. What neither decided
 * is absent, and the locale answers it.
 */
export function mergeRegionalFormats(...levels: ReadonlyArray<RegionalFormat | null | undefined>): RegionalFormat {
  const out: Record<string, unknown> = {};
  for (const field of REGIONAL_FORMAT_FIELDS) {
    for (const level of levels) {
      const value = level?.[field];
      if (value !== null && value !== undefined) {
        out[field] = value;
        break;
      }
    }
  }
  return out as RegionalFormat;
}

/**
 * A number formatted by `Intl`, with the chosen group and decimal marks in place of the locale's.
 *
 * Only those two parts are replaced: the currency symbol, its position, the sign and the digits
 * stay the locale's. With no choice the locale's own marks stand. Shared by the browser and the
 * server so a figure on screen and the same figure on the printed invoice read alike.
 */
export function withNumberSymbols(parts: readonly Intl.NumberFormatPart[], numberFormat: NumberFormat | null | undefined): string {
  if (!numberFormat) return parts.map((part) => part.value).join('');
  const { group, decimal } = NUMBER_FORMAT_SYMBOLS[numberFormat];
  return parts.map((part) => (part.type === 'group' ? group : part.type === 'decimal' ? decimal : part.value)).join('');
}

/** Day, month and year written in an order with a separator: `14/09/2026`, `2026-09-14`. */
export function writeNumericDate(pieces: { day: string; month: string; year: string }, order: DateOrder, separator: string): string {
  const byLetter = { D: pieces.day, M: pieces.month, Y: pieces.year };
  return order
    .split('')
    .map((letter) => byLetter[letter as 'D' | 'M' | 'Y'])
    .join(separator);
}

/**
 * A numeric date as `Intl` wrote it, reordered and re-separated where a format chose to. With no
 * choice the locale's text stands untouched.
 */
export function withDateFormat(parts: readonly Intl.DateTimeFormatPart[], format: RegionalFormat | null | undefined): string {
  if (!format?.dateOrder && !format?.dateSeparator) return parts.map((part) => part.value).join('');
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const localeOrder = parts
    .filter((part) => part.type === 'day' || part.type === 'month' || part.type === 'year')
    .map((part) => (part.type === 'day' ? 'D' : part.type === 'month' ? 'M' : 'Y'))
    .join('');
  const order = format.dateOrder ?? ((DATE_ORDERS as readonly string[]).includes(localeOrder) ? (localeOrder as DateOrder) : 'DMY');
  const separator = format.dateSeparator ?? parts.find((part) => part.type === 'literal')?.value ?? '/';
  const date = writeNumericDate({ day: pick('day'), month: pick('month'), year: pick('year') }, order, separator);
  // A time that came with the date (hour, minute, second) follows it as the locale wrote it.
  const firstTime = parts.findIndex((part) => part.type === 'hour');
  if (firstTime < 0) return date;
  const time = parts
    .slice(firstTime)
    .map((part) => part.value)
    .join('');
  return `${date} ${time}`;
}
