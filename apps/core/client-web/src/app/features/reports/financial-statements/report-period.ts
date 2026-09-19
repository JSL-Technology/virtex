import { toIsoDate } from '../../../shared/utils/date.util';

/**
 * The range a financial report opens on: the year to date, in the reader's own calendar.
 *
 * Shared rather than repeated, so the three statements never disagree about what "this year"
 * means. The calendar-date helper it builds on now lives in `shared/utils/date.util`, so features
 * outside reports (treasury, AP) no longer reach across into the reports feature for it.
 */
export function defaultPeriod(): { startDate: string; endDate: string } {
  const now = new Date();
  return { startDate: `${now.getFullYear()}-01-01`, endDate: toIsoDate(now) };
}

// Re-exported so report pages that already import `toIsoDate` from here keep compiling; its
// canonical home is shared/utils/date.util.
export { toIsoDate };
