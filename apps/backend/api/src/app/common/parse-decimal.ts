/**
 * Reading a number a human wrote, in the format their market writes it.
 *
 * ## Why this is not `parseFloat`
 *
 * `parseFloat` reads one convention — a period for the decimal point, no grouping at all — and
 * fails silently on everything else by returning a *plausible* number rather than an error:
 *
 * | the file says | `parseFloat` | it means         |
 * |---------------|--------------|------------------|
 * | `1.234,56`    | `1.234`      | one thousand-odd |
 * | `1,234.56`    | `1`          | one thousand-odd |
 * | `12abc`       | `12`         | nothing          |
 * | `(500.00)`    | `NaN`        | −500             |
 *
 * The first row is the ordinary way of writing money in most of Latin America, and the second is
 * the ordinary way of writing it in the United States and Mexico. A tenant that imports a
 * three-figure journal from a bank export therefore posted an entry off by a factor of a thousand,
 * and the entry still balanced, because both sides were divided by the same thousand.
 *
 * `null` is returned for anything unreadable so each caller can name the row, the column and the
 * value in its own error rather than inheriting a message from here.
 */

/** `.` for `1,234.56`; `,` for `1.234,56`. */
export type DecimalSeparator = '.' | ',';

/**
 * `"1.234,56"`, `"1,234.56"`, `"(500.00)"`, `"$ 1 234,56"`, `"-1 000"` → a number.
 *
 * An empty or blank value is `0`: a bank or ledger export leaves one of its debit/credit pair
 * blank on every row, and treating that as an error would reject every well-formed file. A value
 * that is *present* and unreadable is `null`, where `parseFloat` produced a number.
 */
export function parseDecimal(
  raw: string | number | null | undefined,
  decimalSeparator: DecimalSeparator,
): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  const value = (raw ?? '').trim();
  if (value === '' || value === '-') return 0;

  // Letters *touching* digits are a typo, not a currency token. `12abc` is how `parseFloat`
  // answered 12 for a value nobody meant as a number; `USD 1.234,56` and `RD$ 1.234,56` keep their
  // symbol at a boundary and are read normally.
  if (/\d[A-Za-z]/.test(value) || /[A-Za-z]\d/.test(value)) return null;

  // Accounting parentheses, and a leading minus that may sit outside a currency symbol.
  const negative = /^\(.*\)$/.test(value) || value.trimStart().startsWith('-');

  // Everything that is not a digit, a separator or a sign is currency symbols and spaces.
  let digits = value.replace(/[()]/g, '').replace(/[^\d.,-]/g, '');
  if (digits === '' || digits === '-') return null;

  // A minus is a sign, and a sign appears once, in first position. `1-234` is a damaged value, not
  // 1234: reading it as a number is the same mistake as reading `12abc` as 12.
  if (digits.slice(1).includes('-')) return null;
  digits = digits.replace(/^-/, '');

  if (decimalSeparator === ',') {
    digits = digits.replace(/\./g, '').replace(/,/g, '.');
  } else {
    digits = digits.replace(/,/g, '');
  }

  // More than one decimal point means two separators were in play and the file does not match the
  // convention the caller declared. Guessing which one was meant is how a figure moves by a
  // thousand.
  if ((digits.match(/\./g) ?? []).length > 1) return null;

  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;

  const magnitude = Math.abs(parsed);
  return negative ? -magnitude : magnitude;
}
