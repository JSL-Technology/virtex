/**
 * The range a financial report opens on: the year to date, in the reader's own calendar.
 *
 * Shared rather than repeated, so the three statements never disagree about what "this year"
 * means — and computed from the local date rather than an ISO timestamp, because `toISOString()`
 * on 1 January in Santo Domingo returns 31 December.
 */
export function defaultPeriod(): { startDate: string; endDate: string } {
  const now = new Date();
  return { startDate: `${now.getFullYear()}-01-01`, endDate: toIsoDate(now) };
}

export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
