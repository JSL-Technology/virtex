import { calendarDateIn, setTenantTimeZone, tenantToday } from './calendar-date-in';

// QA R3-M02: at 20:30 in Santo Domingo it is already tomorrow in UTC.
describe('calendarDateIn', () => {
  const evening = new Date('2026-10-29T00:30:00Z'); // 20:30 on 28 Oct in Santo Domingo (UTC−4)

  it('gives the date of the company timezone, not UTC', () => {
    expect(calendarDateIn('America/Santo_Domingo', evening)).toBe('2026-10-28');
    expect(calendarDateIn('UTC', evening)).toBe('2026-10-29');
  });

  it('falls back to the local calendar for an unknown zone', () => {
    expect(calendarDateIn('Not/AZone', evening)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('tenantToday follows the tenant timezone once known', () => {
    setTenantTimeZone('America/Santo_Domingo');
    expect(tenantToday(evening)).toBe('2026-10-28');
    setTenantTimeZone(null);
  });
});
