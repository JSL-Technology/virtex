/**
 * Calendar dates for the ledger.
 *
 * ## Why this module exists
 *
 * A PostgreSQL `date` column has no time and no zone. The `pg` driver hands it back as the string
 * `'2026-01-31'`, and TypeORM passes that through — so an entity that declares `endDate: Date` is
 * lying, exactly as a `numeric` column declared `number` was until `numericTransformer` landed.
 *
 * The lie was load-bearing. `ClosingAutomationService` passed `period.endDate` to the depreciation
 * run, which called `date.getUTCFullYear()` on it, and the period close therefore failed with
 * `date.getUTCFullYear is not a function` for **every tenant, on every period** — the failure was
 * invisible to the test suite because the integration suite stubs the very service that throws.
 *
 * Two rules follow, and everything here exists to make them cheap to obey:
 *
 * 1. **A calendar date crosses a boundary as an `IsoDate` string, never as a `Date`.** A `Date` is
 *    an instant; a posting date is a day. Converting between them is where a posting dated the 1st
 *    gets filed under the previous month because the server runs in UTC−4.
 * 2. **Anything that accepts a date accepts `Date | string` and normalises immediately.** Callers
 *    hold values that came from a DTO (string), from an entity (string, whatever the type says) and
 *    from `new Date()` (Date). A signature that admits only one of those is a crash waiting for the
 *    first caller that holds another.
 *
 * Every function here is UTC. Not "usually UTC": a `date` column has no zone, so interpreting one
 * in the server's local calendar is always wrong, and the only way to keep that from happening
 * accidentally is for no function in this file to consult local time.
 */

/** `YYYY-MM-DD`. The wire and storage form of a calendar date. */
export type IsoDate = string;

/** `YYYY-MM`. The form a monthly period, a budget line and a fiscal return are keyed by. */
export type IsoMonth = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DateFormatError extends Error {}

/**
 * Any date-ish value as `YYYY-MM-DD`.
 *
 * Accepts what actually reaches these call sites: an `IsoDate`, a full ISO timestamp (whose date
 * part is taken as-is, never shifted), and a `Date` (read in UTC). Anything else throws rather than
 * producing `"Invalid Date"` or `NaN-NaN-NaN`, which is what silently poisoned a report query.
 */
export function toIsoDate(value: Date | string | null | undefined): IsoDate {
  if (value === null || value === undefined) {
    throw new DateFormatError('A date is required');
  }

  if (typeof value === 'string') {
    const head = value.slice(0, 10);
    if (!ISO_DATE.test(head)) {
      throw new DateFormatError(`Not an ISO date: ${JSON.stringify(value)}`);
    }
    return head;
  }

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DateFormatError(`Not a usable date: ${JSON.stringify(value)}`);
  }
  // Deliberately UTC. `toLocaleDateString` or `getFullYear` here is how an entry dated the 1st ends
  // up in the previous month for every deployment east or west of Greenwich.
  return value.toISOString().slice(0, 10);
}

/** True when `value` can be read as a calendar date, without throwing. */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  if (!ISO_DATE.test(value.slice(0, 10))) return false;
  return !Number.isNaN(Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`));
}

/**
 * The UTC instant at the start of a calendar day.
 *
 * For the few places that genuinely need a `Date` — a TypeORM `Between` on a `timestamptz`, date
 * arithmetic — rather than for anything that will be stored back into a `date` column.
 */
export function toUtcDate(value: Date | string): Date {
  return new Date(`${toIsoDate(value)}T00:00:00.000Z`);
}

/** The day before `value`. */
export function previousDay(value: Date | string): IsoDate {
  const d = toUtcDate(value);
  d.setUTCDate(d.getUTCDate() - 1);
  return toIsoDate(d);
}

/** The day after `value`. */
export function nextDay(value: Date | string): IsoDate {
  const d = toUtcDate(value);
  d.setUTCDate(d.getUTCDate() + 1);
  return toIsoDate(d);
}

/** `value` shifted by `days`, which may be negative. */
export function addDaysIso(value: Date | string, days: number): IsoDate {
  const d = toUtcDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/**
 * `value` shifted by `months`, clamped to the end of the target month.
 *
 * 31 January plus one month is 28 (or 29) February, not 3 March. `Date.setUTCMonth` overflows into
 * the next month, which is how a monthly schedule drifts a day at a time.
 */
export function addMonthsIso(value: Date | string, months: number): IsoDate {
  const d = toUtcDate(value);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
  d.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(d);
}

/** Whole calendar months from `from` to `to`, ignoring the day of the month. */
export function monthsBetween(from: Date | string, to: Date | string): number {
  const a = toUtcDate(from);
  const b = toUtcDate(to);
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  );
}

/** Whole days from `from` to `to`. Both ends are calendar days, so this is exact. */
export function daysBetween(from: Date | string, to: Date | string): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000);
}

/** `2026-03` — the month a date belongs to. */
export function toIsoMonth(value: Date | string): IsoMonth {
  return toIsoDate(value).slice(0, 7);
}

/** The four-digit year of a date, as a number. */
export function yearOf(value: Date | string): number {
  return Number(toIsoDate(value).slice(0, 4));
}

/** The month of a date, 1-12. */
export function monthOf(value: Date | string): number {
  return Number(toIsoDate(value).slice(5, 7));
}

/** The first day of the month `value` falls in. */
export function startOfMonthIso(value: Date | string): IsoDate {
  return `${toIsoMonth(value)}-01`;
}

/** The last day of the month `value` falls in. */
export function endOfMonthIso(value: Date | string): IsoDate {
  const iso = toIsoDate(value);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) - 1;
  return `${iso.slice(0, 7)}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
}

/** The first and last day of a calendar month, given its 1-based month number. */
export function monthBounds(year: number, month: number): { from: IsoDate; to: IsoDate } {
  const mm = String(month).padStart(2, '0');
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(daysInMonth(year, month - 1)).padStart(2, '0')}`,
  };
}

/** `AAAAMMDD` — the compact form most tax authorities in the region ask for. */
export function toCompactDate(value: Date | string): string {
  return toIsoDate(value).replace(/-/g, '');
}

/** Today, in UTC, as an `IsoDate`. */
export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

/** @param month 0-based, matching `Date.getUTCMonth`. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
