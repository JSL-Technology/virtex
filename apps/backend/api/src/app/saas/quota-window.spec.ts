import { monthlyQuotaWindow } from './quota-window';

describe('monthly quota window', () => {
  const d = (iso: string) => new Date(iso);

  it('an ANNUAL plan still resets the monthly quota every month (the key used to be the year end)', () => {
    const periodEnd = d('2027-11-07T00:00:00Z');
    const w = monthlyQuotaWindow(periodEnd, periodEnd, d('2026-11-08T12:00:00Z'));
    expect(w.key).toBe('2026-12-07');
    expect(w.from.toISOString()).toBe('2026-11-07T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-12-07T00:00:00.000Z');
    // A month later, a new window and a new counter.
    expect(monthlyQuotaWindow(periodEnd, periodEnd, d('2026-12-07T00:00:01Z')).key).toBe('2027-01-07');
  });

  it('a MONTHLY plan keeps its period as the window', () => {
    const periodEnd = d('2026-11-20T00:00:00Z');
    expect(monthlyQuotaWindow(periodEnd, periodEnd, d('2026-11-08T00:00:00Z')).key).toBe('2026-11-20');
  });

  it('an anchor on the 31st does not drift', () => {
    const periodEnd = d('2027-01-31T00:00:00Z');
    expect(monthlyQuotaWindow(periodEnd, periodEnd, d('2026-11-15T00:00:00Z')).key).toBe('2026-11-30');
    expect(monthlyQuotaWindow(periodEnd, periodEnd, d('2026-12-15T00:00:00Z')).key).toBe('2026-12-31');
  });

  it('in the grace period after the period ended, windows keep moving forward', () => {
    const periodEnd = d('2026-10-01T00:00:00Z');
    const grace = d('2026-12-01T00:00:00Z');
    expect(monthlyQuotaWindow(periodEnd, grace, d('2026-11-08T00:00:00Z')).key).toBe('2026-12-01');
  });

  it('without a live subscription it is the calendar month', () => {
    expect(monthlyQuotaWindow(null, null, d('2026-11-08T00:00:00Z')).key).toBe('2026-11');
    expect(monthlyQuotaWindow(d('2026-01-01T00:00:00Z'), d('2026-01-01T00:00:00Z'), d('2026-11-08T00:00:00Z')).key).toBe('2026-11');
  });
});
