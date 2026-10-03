import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * The same rule the API applies to a contact's phone (`IsPhoneLike`, QA M-04): digits with the
 * usual separators, an optional leading `+` and an optional extension. Not E.164 — a switchboard
 * "(809) 555-1234 ext. 12" is a fine thing to store — but not "abc" either. Empty passes: the
 * field is optional.
 */
export const PHONE_LIKE_PATTERN = /^\+?[0-9\s().-]{6,24}(\s*(ext\.?|x|#)\s*[0-9]{1,6})?$/i;

export const phoneLikeValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = typeof control.value === 'string' ? control.value.trim() : control.value;
  if (value === null || value === undefined || value === '') return null;
  return PHONE_LIKE_PATTERN.test(String(value)) ? null : { phone: true };
};
