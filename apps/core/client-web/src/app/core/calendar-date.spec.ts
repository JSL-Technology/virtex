import { TestBed } from '@angular/core/testing';

import { FormatService, LocaleStore } from '@virteex/shared/ui-i18n';

/**
 * An accounting date is not an instant, and rendering it as one shows the day before.
 *
 * `2026-09-14` has no time and no zone. Parsed as midnight UTC and rendered in
 * `America/Santo_Domingo` (UTC−4) it becomes the 13th at 20:00, so the screen says 09/13/2026. The
 * service always had a `dateOnly` option for this and documented the defect by name; thirty-six
 * call sites did not pass it. Every invoice in the product was dated a day early — in its list, on
 * the document and in "what falls due" — and a balance sheet requested for `asOfDate=2026-09-14`
 * titled itself "As of 9/13/2026", while an income statement for the year titled itself "From
 * 12/31/2025".
 *
 * The shape of the value decides it now, so no call site can forget. These tests hold the line in
 * a zone behind UTC, which is where the defect shows.
 *
 * They live here rather than beside the service: `shared-ui-i18n` runs its suite in a Node
 * environment, on purpose, and the Angular services in it are exercised by the applications that
 * inject them.
 */
describe('calendar dates survive the reader timezone', () => {
  let format: FormatService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [FormatService, LocaleStore] });
    format = TestBed.inject(FormatService);
    // The tenant's context is what decides the zone — the reader's browser never does, because a
    // journal entry posted on the first in Santo Domingo must not read as the last day of the
    // previous month for someone in Los Angeles.
    const store = TestBed.inject(LocaleStore);
    store.setLanguage('es');
    store.setTenantContext({
      language: 'es',
      locale: 'es-DO',
      direction: 'ltr',
      countryCode: 'DO',
      currency: 'DOP',
      timezone: 'America/Santo_Domingo',
      booksLanguage: 'es',
      firstDayOfWeek: 0,
    });
  });

  it('renders a bare YYYY-MM-DD as the day it names', () => {
    expect(format.date('2026-09-14', 'date')).toBe('14/09/2026');
    expect(format.date('2026-01-01', 'date')).toBe('01/01/2026');
    // The boundary the bug lived on: the first of the year, in a zone behind UTC.
    expect(format.date('2026-01-01', 'date')).not.toBe('31/12/2025');
  });

  it('still converts a real instant into the reader zone', () => {
    // 02:00 UTC is the previous day at 22:00 in Santo Domingo, and that IS the right answer.
    expect(format.date('2026-09-14T02:00:00.000Z', 'date')).toBe('13/09/2026');
  });

  it('does not treat a midnight timestamp as a calendar date', () => {
    // Ambiguous by construction: it may be a genuine instant, so it is converted, not assumed.
    expect(format.date('2026-09-14T00:00:00.000Z', 'date')).toBe('13/09/2026');
  });

  it('honours an explicit dateOnly for a value that is not bare', () => {
    expect(format.date('2026-09-14T00:00:00.000Z', 'date', { dateOnly: true })).toBe('14/09/2026');
  });

  it('leaves empty values empty', () => {
    for (const value of [null, undefined, '']) {
      expect(format.date(value, 'date')).toBe('');
    }
  });
});
