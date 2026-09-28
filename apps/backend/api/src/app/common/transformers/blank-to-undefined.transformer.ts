import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

/**
 * An optional text field left blank is ABSENT, not an empty value.
 *
 * A form serialises an untouched input as `""`. On an `@IsOptional()` field that is not "not
 * given": `@IsOptional` only skips `null` and `undefined`, so `""` went on to `@IsEmail()` and
 * `@Length(1, 32)` and the whole request was refused. That is how creating a customer or a
 * supplier became impossible from the UI (QA C-04): the form sent `"email": ""` and
 * `"identityDocumentTypeCode": ""`, and every save answered 400.
 *
 * The client now omits blanks too, but a contract that breaks on the most common shape a form
 * produces is a contract every future client has to rediscover. Normalising at the boundary makes
 * the rule hold for all of them. Whitespace-only counts as blank. `null` is preserved, because on
 * an update it means "clear this field".
 */
export function blankToUndefined({ value }: { value: unknown }): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return value;
}

export const BlankToUndefined = () => applyDecorators(Transform(blankToUndefined));

/**
 * A phone number as people write it: digits with the usual separators, an optional leading `+`
 * and an optional extension. Not E.164 — a customer's switchboard "(809) 555-1234 ext. 12" is a
 * valid thing to store — but no longer "abc" either (QA M-04).
 */
export const PHONE_PATTERN = /^\+?[0-9\s().-]{6,24}(\s*(ext\.?|x|#)\s*[0-9]{1,6})?$/i;

export const IsPhoneLike = () =>
  applyDecorators(Matches(PHONE_PATTERN, { message: 'validation.constraints.phone_format' }));
