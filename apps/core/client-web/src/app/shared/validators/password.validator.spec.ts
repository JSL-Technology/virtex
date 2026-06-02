import { FormControl } from '@angular/forms';
import {
  strongPasswordValidator,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from './password.validator';

// H4 FIX: this spec previously imported a non-existent `Password` class (stale scaffold) and
// could not compile/run. It now locks the shared password policy so register/reset/set/change
// stay aligned with the backend (min 12 / max 72 / upper + lower + (digit OR symbol)).
describe('strongPasswordValidator', () => {
  const validate = (value: string) =>
    strongPasswordValidator()(new FormControl(value));

  it('treats an empty value as valid (defer to Validators.required)', () => {
    expect(validate('')).toBeNull();
  });

  it('accepts a compliant password (upper + lower + digit, >= 12 chars)', () => {
    expect(validate('ValidPass123!')).toBeNull();
  });

  it('accepts complexity satisfied by a symbol instead of a digit', () => {
    expect(validate('ValidPassword!')).toBeNull();
  });

  it('rejects passwords shorter than the minimum length', () => {
    const result = validate('Short1!');
    expect(result?.['strongPassword']?.['minLength']).toEqual({
      requiredLength: PASSWORD_MIN_LENGTH,
      actualLength: 'Short1!'.length,
    });
  });

  it('rejects passwords longer than the maximum length', () => {
    const tooLong = 'A1' + 'a'.repeat(PASSWORD_MAX_LENGTH);
    const result = validate(tooLong);
    expect(result?.['strongPassword']?.['maxLength']).toEqual({
      maxLength: PASSWORD_MAX_LENGTH,
      actualLength: tooLong.length,
    });
  });

  it('requires an uppercase letter', () => {
    expect(validate('lowercase123!')?.['strongPassword']?.['missingUppercase']).toBe(true);
  });

  it('requires a lowercase letter', () => {
    expect(validate('UPPERCASE123!')?.['strongPassword']?.['missingLowercase']).toBe(true);
  });

  it('requires a digit or special character', () => {
    expect(
      validate('OnlyLettersHere')?.['strongPassword']?.['missingNumberOrSpecial'],
    ).toBe(true);
  });
});
