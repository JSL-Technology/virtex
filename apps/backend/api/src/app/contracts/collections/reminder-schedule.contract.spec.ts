import {
  REMINDER_STEP_GRACE_DAYS,
  normalizeReminderDays,
  reminderStepFor,
  reminderToneFor,
} from './reminder-schedule.contract';

/** The reminder schedule's rules, as rules (TES-13). */
describe('reminder schedule', () => {
  const days = [-3, 1, 7, 15, 30];

  it('an invoice is at the latest step that has come', () => {
    expect(reminderStepFor(days, -10)).toBeNull();
    expect(reminderStepFor(days, -3)).toBe(-3);
    expect(reminderStepFor(days, 0)).toBe(-3);
    expect(reminderStepFor(days, 1)).toBe(1);
    expect(reminderStepFor(days, 9)).toBe(7);
    expect(reminderStepFor(days, 30)).toBe(30);
  });

  it('a step that waited past its grace is dropped, not sent late', () => {
    expect(reminderStepFor([1], 1 + REMINDER_STEP_GRACE_DAYS - 1)).toBe(1);
    expect(reminderStepFor([1], 1 + REMINDER_STEP_GRACE_DAYS)).toBeNull();
    // Turning the schedule on sends nothing for what went past its last step long ago.
    expect(reminderStepFor(days, 120)).toBeNull();
  });

  it('days are whole, within bounds, distinct and in order', () => {
    expect(normalizeReminderDays([30, -3, 7, 7])).toEqual({ ok: true, days: [-3, 7, 30] });
    expect(normalizeReminderDays([])).toMatchObject({ ok: false, key: 'organizations.settings.reminder_days_count' });
    expect(normalizeReminderDays('1,7')).toMatchObject({ ok: false, key: 'organizations.settings.reminder_days_count' });
    expect(normalizeReminderDays([-61])).toMatchObject({ ok: false, key: 'organizations.settings.reminder_days_range' });
    expect(normalizeReminderDays([366])).toMatchObject({ ok: false, key: 'organizations.settings.reminder_days_range' });
    expect(normalizeReminderDays([2.5])).toMatchObject({ ok: false, key: 'organizations.settings.reminder_days_range' });
  });

  it('the tone follows the worklist’s thresholds', () => {
    expect(reminderToneFor(-3)).toBe('cordial');
    expect(reminderToneFor(0)).toBe('cordial');
    expect(reminderToneFor(15)).toBe('formal');
    expect(reminderToneFor(30)).toBe('formal');
    expect(reminderToneFor(31)).toBe('firm');
  });
});
