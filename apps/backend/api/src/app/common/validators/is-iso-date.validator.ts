import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Exactly `YYYY-MM-DD`, and a day that exists.
 *
 * ## Why `@IsDateString()` was not enough
 *
 * Every date query parameter in the product was validated with `@IsDateString()`, which is
 * `validator.isISO8601` in its default, non-strict mode. Measured against the version this repo
 * installs, that accepts:
 *
 * | value          | `@IsDateString()` | reality                                        |
 * |----------------|-------------------|------------------------------------------------|
 * | `2026-02-31`   | accepted          | no such day                                    |
 * | `2026-02-29`   | accepted          | 2026 is not a leap year                        |
 * | `20260315`     | accepted          | basic format; `slice(0, 10)` yields `2026-03-1` |
 * | `2026-03-15 `  | accepted          | trailing space reaches the query               |
 *
 * None of those is a harmless nuisance. A value that passes validation and then fails to parse
 * reaches `toIsoDate`, which throws a plain `DateFormatError`, which Nest reports as **500 Internal
 * Server Error** — so a mistyped date in a URL looks to the operator like the reporting engine
 * crashed. The ones that parse are worse: `20260315` silently becomes a different day.
 *
 * A calendar date is not a timestamp, and this deliberately refuses the timestamp forms
 * `@IsDateString()` allows. A posting date, a cut-off and a period boundary are days; admitting
 * `2026-03-15T22:00:00Z` invites exactly the timezone shift `common/dates.ts` exists to prevent.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` is `YYYY-MM-DD` naming a real day. `2026-02-31` is not. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;

  const [, year, month, day] = match;
  const asNumbers = { year: Number(year), month: Number(month), day: Number(day) };
  if (asNumbers.month < 1 || asNumbers.month > 12) return false;
  if (asNumbers.day < 1 || asNumbers.day > 31) return false;

  // Round-trip through UTC: February 31st comes back as March 3rd, and the mismatch is the test.
  const parsed = new Date(Date.UTC(asNumbers.year, asNumbers.month - 1, asNumbers.day));
  return (
    parsed.getUTCFullYear() === asNumbers.year &&
    parsed.getUTCMonth() === asNumbers.month - 1 &&
    parsed.getUTCDate() === asNumbers.day
  );
}

@ValidatorConstraint({ name: 'isIsoDate', async: false })
export class IsIsoDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isCalendarDate(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'VALIDATION.CONSTRAINTS.IS_ISO_DATE';
  }
}

/** A calendar date as `YYYY-MM-DD`. Rejects timestamps, basic format and days that do not exist. */
export function IsIsoDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsIsoDateConstraint,
    });
  };
}
