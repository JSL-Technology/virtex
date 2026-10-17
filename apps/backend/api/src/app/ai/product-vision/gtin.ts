/**
 * Whether a barcode read from a photo is a well-formed GTIN (EAN-8, UPC-A, EAN-13, GTIN-14).
 *
 * The last digit of every GTIN is a check digit over the others, so a single misread digit — the
 * commonest way a photo reading goes wrong — is caught arithmetically, with no model involved.
 * Codes of other lengths (internal labels, Code-128 with letters) cannot be checked this way and
 * are reported as `unchecked` rather than as wrong.
 */
export type GtinCheck = 'valid' | 'invalid' | 'unchecked';

export function checkGtin(code: string | null | undefined): GtinCheck {
  if (!code) return 'unchecked';
  const digits = code.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return 'unchecked';

  const body = digits.slice(0, -1);
  let sum = 0;
  // Weights alternate 3,1,3,1… starting from the digit nearest the check digit.
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(digits[digits.length - 1]) ? 'valid' : 'invalid';
}
