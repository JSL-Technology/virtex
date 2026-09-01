import {
  DEFAULT_FISCAL_TIME_ZONE,
  dgiiDate,
  dgiiTimestamp,
  fiscalDate,
  isValidTimeZone,
  isoToDgiiDate,
  organizationTimeZone,
} from './fiscal-clock';

/**
 * Fiscal dates are statements about local time in the taxpayer's country, and the server runs in
 * UTC. Every case below is one that produced a wrong date before.
 */
describe('fiscal-clock', () => {
  // 2026-09-01T00:30:00Z is 2026-08-31 20:30 in Santo Domingo: still August, still yesterday.
  const lateAugustEvening = new Date('2026-09-01T00:30:00Z');

  it('reads the calendar day in the taxpayer’s zone, not the server’s', () => {
    expect(fiscalDate('America/Santo_Domingo', lateAugustEvening)).toBe('2026-08-31');
    expect(fiscalDate('UTC', lateAugustEvening)).toBe('2026-09-01');
  });

  it('keeps a late-evening sale in the month it was made', () => {
    // The whole point: this document belongs to August's 607, not September's.
    expect(fiscalDate('America/Santo_Domingo', lateAugustEvening).startsWith('2026-08')).toBe(true);
  });

  it('formats DGII dates as DD-MM-YYYY', () => {
    expect(dgiiDate('America/Santo_Domingo', lateAugustEvening)).toBe('31-08-2026');
  });

  it('formats FechaHoraFirma as DD-MM-YYYY HH:mm:ss in local time', () => {
    expect(dgiiTimestamp('America/Santo_Domingo', lateAugustEvening)).toBe('31-08-2026 20:30:00');
  });

  it('renders midnight as 00, never 24', () => {
    const midnight = new Date('2026-08-31T04:00:00Z'); // 00:00 in Santo Domingo
    expect(dgiiTimestamp('America/Santo_Domingo', midnight)).toBe('31-08-2026 00:00:00');
  });

  it('follows daylight saving rather than a fixed offset', () => {
    // Santiago is UTC−4 in January (southern summer) and UTC−3 in July. A hardcoded offset is
    // wrong for half the year in exactly the markets this product sells into.
    const january = new Date('2026-01-15T12:00:00Z');
    const july = new Date('2026-07-15T12:00:00Z');
    const janHour = dgiiTimestamp('America/Santiago', january).split(' ')[1].slice(0, 2);
    const julHour = dgiiTimestamp('America/Santiago', july).split(' ')[1].slice(0, 2);
    expect(janHour).not.toBe(julHour);
  });

  it('re-renders an ISO date without moving it across a zone', () => {
    expect(isoToDgiiDate('2026-08-31')).toBe('31-08-2026');
    expect(isoToDgiiDate('2026-08-31T23:00:00.000Z')).toBe('31-08-2026');
  });

  describe('organizationTimeZone', () => {
    it('falls back to the country’s zone, because the column default is never right', () => {
      expect(organizationTimeZone({ country: 'DO', timezone: 'UTC' })).toBe('America/Santo_Domingo');
      expect(organizationTimeZone({ country: 'MX', timezone: null })).toBe('America/Mexico_City');
    });

    it('honours an explicit tenant zone over its country’s', () => {
      expect(organizationTimeZone({ country: 'US', timezone: 'America/Los_Angeles' })).toBe(
        'America/Los_Angeles',
      );
    });

    it('does not invent a zone for a country it does not know', () => {
      expect(organizationTimeZone({ country: 'ZZ', timezone: 'UTC' })).toBe(DEFAULT_FISCAL_TIME_ZONE);
      expect(organizationTimeZone(null)).toBe(DEFAULT_FISCAL_TIME_ZONE);
    });
  });

  it('survives a zone the runtime does not know instead of failing an invoice', () => {
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(() => fiscalDate('Mars/Olympus_Mons', lateAugustEvening)).not.toThrow();
  });
});
