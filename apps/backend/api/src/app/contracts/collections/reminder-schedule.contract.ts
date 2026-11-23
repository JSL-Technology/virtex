/**
 * The company's schedule of payment reminders: on which days, counted from an invoice's due date,
 * a reminder goes out on its own (TES-13).
 *
 * A day is relative to the due date — `-3` is three days before it, `0` the day itself, `30` a month
 * past it — which is how the products this one is measured against state the same rule (Xero, Zoho,
 * QuickBooks: «N days before / after the due date»). Stored on the settings row
 * (`collections_reminder_days`), edited from «Configuración», and read by the schedule. Here, rather
 * than in either module, because both organizations (which validates the setting) and collections
 * (which acts on it) need the same bounds.
 */

/** Earliest a reminder may go out: two months before the due date. */
export const REMINDER_DAY_MIN = -60;
/** Latest: a year past it. Past that a debt is a person's to chase, not a schedule's. */
export const REMINDER_DAY_MAX = 365;
/** At most this many reminders per invoice. */
export const REMINDER_STEPS_MAX = 8;
/** What a company starts with: a heads-up before the due date, then four after it. */
export const DEFAULT_REMINDER_DAYS: readonly number[] = [-3, 1, 7, 15, 30];

/**
 * How long a step that did not go out on its day may still go out.
 *
 * The schedule did not run that day, the customer had promised to pay, or someone had called the
 * day before: the step waits, and goes out once none of that holds — within the week. After that it
 * is dropped rather than sent late. Turning the schedule on must not send a reminder for every
 * invoice that went past its last step months ago.
 */
export const REMINDER_STEP_GRACE_DAYS = 7;

/** The days, validated and in order, or the catalogue key explaining the refusal. */
export function normalizeReminderDays(
  value: unknown,
): { ok: true; days: number[] } | { ok: false; key: string; params?: Record<string, unknown> } {
  if (!Array.isArray(value) || value.length === 0 || value.length > REMINDER_STEPS_MAX) {
    return { ok: false, key: 'organizations.settings.reminder_days_count', params: { max: REMINDER_STEPS_MAX } };
  }
  const days = new Set<number>();
  for (const day of value) {
    if (!Number.isInteger(day) || (day as number) < REMINDER_DAY_MIN || (day as number) > REMINDER_DAY_MAX) {
      return {
        ok: false,
        key: 'organizations.settings.reminder_days_range',
        params: { min: REMINDER_DAY_MIN, max: REMINDER_DAY_MAX },
      };
    }
    days.add(day as number);
  }
  return { ok: true, days: [...days].sort((a, b) => a - b) };
}

/**
 * The step of the schedule an invoice `daysOverdue` past its due date is at, or null.
 *
 * The latest day that has come, while it is within {@link REMINDER_STEP_GRACE_DAYS} of it. An
 * invoice past the grace of its last step is at no step: nothing more goes out on its own.
 */
export function reminderStepFor(days: readonly number[], daysOverdue: number): number | null {
  let step: number | null = null;
  for (const day of days) if (day <= daysOverdue && (step === null || day > step)) step = day;
  if (step === null) return null;
  return daysOverdue - step < REMINDER_STEP_GRACE_DAYS ? step : null;
}

/** The tone a scheduled reminder is recorded with: the worklist's thresholds (`rankCollection`). */
export function reminderToneFor(daysOverdue: number): 'cordial' | 'formal' | 'firm' {
  if (daysOverdue <= 0) return 'cordial';
  return daysOverdue <= 30 ? 'formal' : 'firm';
}
