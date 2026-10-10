import { addDaysIso, addMonthsIso, previousDay, toIsoDate, type IsoDate } from '../common/dates';
import { Frequency } from './entities/recurring-journal-entry.entity';

/** What the schedule needs to know about a recurring entry. */
export interface RecurringSchedule {
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
}

/** No catch-up reaches further back than a year of daily occurrences. */
export const MAX_CATCH_UP = 366;

/**
 * The n-th date a recurring entry falls on, counting the start as the 0th.
 *
 * Monthly and annual dates come from the START, not from the previous occurrence, and are
 * clamped to the month's end: a rent starting on 31 January posts on 28 (or 29) February and on
 * 31 March again — chaining from the previous date would have drifted it to the 28th for good. 29
 * February posts on 28 February in a common year.
 */
export function occurrence(schedule: RecurringSchedule, index: number): IsoDate {
  const start = toIsoDate(schedule.startDate);
  switch (schedule.frequency) {
    case Frequency.DAILY:
      return addDaysIso(start, index);
    case Frequency.WEEKLY:
      return addDaysIso(start, index * 7);
    case Frequency.MONTHLY:
      return addMonthsIso(start, index);
    case Frequency.ANNUALLY:
      return addMonthsIso(start, index * 12);
    default:
      throw new Error(`Unknown frequency ${String(schedule.frequency)}`);
  }
}

/**
 * Every date the entry falls on after `after` (exclusive) and up to `through` (inclusive), within
 * its start and end, oldest first, at most `limit` of them.
 *
 * The scheduler asked only «is it due TODAY?», so a day the job did not run — a deployment, an
 * outage, a queue that was down — was an occurrence lost for good: that month's rent was simply
 * never booked. Asking for everything since the last one posted is what makes a missed day a late
 * posting instead of a missing one.
 */
export function occurrencesBetween(
  schedule: RecurringSchedule,
  after: IsoDate | null,
  through: IsoDate,
  limit = MAX_CATCH_UP,
): IsoDate[] {
  const end = schedule.endDate ? toIsoDate(schedule.endDate) : null;
  const last = end && end < through ? end : through;
  const dates: IsoDate[] = [];
  for (let index = 0; dates.length < limit; index++) {
    const date = occurrence(schedule, index);
    if (date > last) break;
    if (after === null || date > after) dates.push(date);
    // A guard against a schedule that never advances; every frequency moves forward by a day at least.
    if (index > 100_000) break;
  }
  return dates;
}

/** The next date the entry will post on after `after`, or null when its end has passed. */
export function nextOccurrence(schedule: RecurringSchedule, after: IsoDate): IsoDate | null {
  const end = schedule.endDate ? toIsoDate(schedule.endDate) : null;
  for (let index = 0; index < 100_000; index++) {
    const date = occurrence(schedule, index);
    if (end && date > end) return null;
    if (date > after) return date;
  }
  return null;
}

/** The day before the start, as the «last posted» of a template that has never posted. */
export function beforeStart(schedule: RecurringSchedule): IsoDate {
  return previousDay(toIsoDate(schedule.startDate));
}
