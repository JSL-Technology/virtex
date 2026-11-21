import { DateTime } from 'luxon';

/**
 * The monthly window a quota is counted in.
 *
 * With a live subscription the window is anchored to its billing day: it ends on the next
 * occurrence of the day of month the subscription period ends on, and starts one month earlier.
 * Otherwise it is the calendar month (UTC).
 *
 * It used to BE the subscription period. That is right for a monthly plan and wrong for every other:
 * on an annual plan a "10 invoices a month" quota keyed itself `2027-11-07` and became 10 invoices a
 * YEAR (audit 2026-11-07, FAC observed the key). A monthly quota now resets monthly whatever the
 * billing cycle, and for a monthly plan nothing changes (the window equals its period).
 */
export interface QuotaWindow {
  from: Date;
  to: Date;
  /** The counter's period key: the window's end date (anchored) or `yyyy-MM` (calendar month). */
  key: string;
}

export function monthlyQuotaWindow(
  subscriptionPeriodEnd: Date | null | undefined,
  effectiveEnd: Date | null | undefined,
  now: Date = new Date(),
): QuotaWindow {
  const live = effectiveEnd && effectiveEnd > now && subscriptionPeriodEnd;
  if (!live) {
    const start = DateTime.fromJSDate(now).toUTC().startOf('month');
    return { from: start.toJSDate(), to: start.plus({ months: 1 }).toJSDate(), key: start.toFormat('yyyy-MM') };
  }
  const anchor = DateTime.fromJSDate(subscriptionPeriodEnd).toUTC();
  const instant = DateTime.fromJSDate(now).toUTC();
  // The window end is the first `anchor ± k months` after `now`. Every candidate is computed from the
  // anchor itself (never from the previous step), so an anchor on the 31st does not drift to the 28th.
  let k = 0;
  if (anchor > instant) {
    while (anchor.plus({ months: k - 1 }) > instant) k -= 1;
  } else {
    // A period that ended while the grace period still runs: count forward.
    while (anchor.plus({ months: k }) <= instant) k += 1;
  }
  const end = anchor.plus({ months: k });
  return {
    from: end.minus({ months: 1 }).toJSDate(),
    to: end.toJSDate(),
    key: end.toFormat('yyyy-MM-dd'),
  };
}
