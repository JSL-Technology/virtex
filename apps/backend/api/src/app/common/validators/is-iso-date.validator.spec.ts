import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { IsOptional } from 'class-validator';
import { IsIsoDate, isCalendarDate } from './is-iso-date.validator';

class Period {
  @IsIsoDate()
  @IsOptional()
  startDate?: string;
}

function errorsFor(value: unknown): string[] {
  const dto = new Period();
  (dto as { startDate?: unknown }).startDate = value;
  return validateSync(dto).flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('IsIsoDate', () => {
  it('accepts a calendar day', () => {
    for (const value of ['2026-03-15', '2024-02-29', '1999-12-31', '2026-01-01']) {
      expect(isCalendarDate(value)).toBe(true);
      expect(errorsFor(value)).toEqual([]);
    }
  });

  /**
   * Each of these was accepted by `@IsDateString()`, the decorator every date query parameter in
   * the product used. The first two reach `new Date(...)` as `Invalid Date` and surface to the
   * caller as a 500; the third silently becomes a different day.
   */
  it.each([
    ['2026-02-31', 'a day February does not have'],
    ['2026-02-29', '29 February in a year that is not a leap year'],
    ['20260315', 'ISO basic format, which slices to 2026-03-1'],
    ['2026-03-15 ', 'a trailing space'],
    ['2026-3-5', 'unpadded components'],
    ['2026-13-01', 'a thirteenth month'],
    ['2026-00-10', 'a zeroth month'],
    ['2026-03-00', 'a zeroth day'],
    ['not-a-date', 'text'],
    ['', 'the empty string'],
  ])('rejects %s (%s)', (value) => {
    expect(isCalendarDate(value)).toBe(false);
    expect(errorsFor(value)).toEqual(['VALIDATION.CONSTRAINTS.IS_ISO_DATE']);
  });

  /**
   * A calendar date is a day, not an instant. Admitting `2026-03-15T22:00:00Z` is how a posting
   * dated the 15th is filed under the 16th for a tenant east of Greenwich.
   */
  it('rejects timestamps, which are not calendar dates', () => {
    for (const value of ['2026-03-15T00:00:00Z', '2026-03-15T22:00:00-04:00']) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });

  it('rejects values that are not strings', () => {
    for (const value of [20260315, new Date(), null, {}, ['2026-03-15']]) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });

  it('leaves an absent optional value alone', () => {
    expect(errorsFor(undefined)).toEqual([]);
  });
});
