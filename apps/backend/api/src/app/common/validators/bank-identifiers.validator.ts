import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ValidateBy, ValidationOptions } from 'class-validator';

/**
 * Bank identifiers, checked rather than merely length-limited (QA A-06: "###" was a valid IBAN).
 *
 * IBAN (ISO 13616): two letters, two check digits, up to 30 alphanumerics, and the whole thing ≡ 1
 * mod 97 once the first four characters are moved to the end and letters are expanded to numbers.
 * The mod-97 check is what catches a mistyped digit, which is the error that actually happens.
 *
 * BIC/SWIFT (ISO 9362): four letters (bank), two letters (country), two alphanumerics (location),
 * optionally three alphanumerics (branch).
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

const normalise = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() || undefined : value;

export const IsIban = (options?: ValidationOptions) =>
  applyDecorators(
    Transform(normalise),
    ValidateBy(
      { name: 'isIban', validator: { validate: (value) => typeof value === 'string' && isValidIban(value) } },
      { message: 'validation.constraints.iban', ...options },
    ),
  );

export const IsBic = (options?: ValidationOptions) =>
  applyDecorators(
    Transform(normalise),
    ValidateBy(
      { name: 'isBic', validator: { validate: (value) => typeof value === 'string' && isValidBic(value) } },
      { message: 'validation.constraints.bic', ...options },
    ),
  );
