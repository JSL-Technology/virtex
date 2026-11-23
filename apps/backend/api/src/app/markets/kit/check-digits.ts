/**
 * The arithmetic most identity documents share, for the markets' own checks to compose.
 *
 * Each market's `identity.ts` implements its authority's published rule from these pieces. They are
 * pure and total: any input, including nonsense, returns a value rather than throwing, because a
 * validator that throws on malformed input turns a rejected form field into a 500.
 */

/**
 * Digits with the separators an authority prints removed, or `null` when the input contains anything
 * else.
 *
 * Stripping is not ignoring. A value containing letters is not a mis-formatted number, it is a
 * different string: deleting the letters made `900123456K` validate as a NIT `900123456`. Only
 * space, hyphen, dot, slash and parentheses are separators.
 */
export function numericOnly(value: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[0-9\s.\-/()]+$/.test(trimmed)) return null;
  return trimmed.replace(/\D/g, '');
}

/** Upper-cased, keeping only the characters an alphanumeric identifier is made of. */
export function alphanumeric(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-ZÑ&]/g, '');
}

/**
 * Weighted modulus-11 check, the family most identifiers belong to.
 *
 * @param body     Digits preceding the check digit.
 * @param weights  Multiplier per position, aligned to `body` from the left.
 * @param map      Turns the remainder into the expected check character. Authorities differ here far
 *                 more than in the sum itself, which is why it is a parameter.
 */
export function modulus11(
  body: string,
  weights: readonly number[],
  map: (remainder: number) => string | null,
): string | null {
  if (body.length !== weights.length) return null;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[i]) * weights[i];
  }
  return map(sum % 11);
}

/**
 * Luhn (modulus 10).
 *
 * Doubling starts at the RIGHTMOST digit of the body and alternates leftwards. Deriving the parity
 * from the body's length from the left gives the right answer only for odd-length bodies.
 */
export function luhnCheckDigit(body: string): string {
  let sum = 0;
  let double = true;
  for (let i = body.length - 1; i >= 0; i--) {
    let digit = Number(body[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

/** The first two digits of an identifier, for checks that read the kind off its prefix. */
export function digitPrefix(value: string): string {
  return (numericOnly(value) ?? '').slice(0, 2);
}
