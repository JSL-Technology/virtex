import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * The same checks the API applies (`bank-identifiers.validator.ts` on the server): an IBAN must
 * pass ISO 13616's mod-97 check, a BIC must have the ISO 9362 shape. "###" is neither (QA A-06).
 * Empty passes: both fields are optional.
 */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function isValidBic(value: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value.replace(/\s+/g, '').toUpperCase());
}

export const ibanValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = typeof control.value === 'string' ? control.value.trim() : '';
  return !value || isValidIban(value) ? null : { pattern: true };
};

export const bicValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = typeof control.value === 'string' ? control.value.trim() : '';
  return !value || isValidBic(value) ? null : { pattern: true };
};
