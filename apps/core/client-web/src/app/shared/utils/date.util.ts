/**
 * Turn a local `Date` into a `YYYY-MM-DD` string using the reader's own calendar.
 *
 * Deliberately built from the local date parts rather than `toISOString()`: `toISOString()` on
 * 1 January in Santo Domingo returns 31 December, because the UTC shift moves the day across
 * midnight. Any feature that needs a calendar date for a form or a report reads this, so they never
 * disagree about what day it is.
 */
export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
