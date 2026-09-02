/**
 * Money arithmetic for the ledger.
 *
 * ## Why cents
 *
 * The balance check used to be `Math.abs(totalDebit - totalCredit) > 0.01`, which is wrong twice
 * over. It accepts a real one-cent imbalance, so a ledger could be posted permanently out of
 * balance by a cent per entry and nothing would ever report it. And because `NaN > 0.01` is
 * `false`, it accepts an entry whose totals are not numbers at all — which is how a debit of
 * `"01500.00200.00"`, produced by string concatenation over untransformed `numeric` columns, was
 * accepted as balanced.
 *
 * Summing in integer cents removes both. Every amount a ledger deals in is a whole number of
 * minor units, integers up to 2^53 are exact in IEEE-754, and an exact comparison against zero
 * replaces a tolerance that was hiding errors rather than absorbing them.
 *
 * Currencies with no minor unit (CLP, PYG, JPY) and the three-decimal dinars are still exact here:
 * `toCents` on a whole number of pesos gives a whole number of cents, and the round trip is
 * lossless. `scale` exists for the places that need to know the real minor unit — an invoice
 * total, an FX conversion — and defaults to 2 because every column in this schema is `scale: 2`.
 */

/** The largest amount this module handles exactly: 2^53 cents, about 90 trillion units. */
const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {}

/**
 * A finite number, or a throw.
 *
 * Every amount entering the ledger passes through here. `NaN`, `Infinity`, `null`, `undefined` and
 * strings that do not parse are rejected at the boundary rather than propagating into a total that
 * silently compares false against every threshold.
 */
export function requireFiniteAmount(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new MoneyError(
      `${field} must be a finite number, received ${JSON.stringify(value)}`,
    );
  }
  if (Math.abs(parsed) * 100 > MAX_SAFE_CENTS) {
    throw new MoneyError(`${field} exceeds the representable range`);
  }
  return parsed;
}

/** Integer minor units, rounded half away from zero — the rule every tax authority states. */
export function toCents(amount: number, scale = 2): number {
  const factor = 10 ** scale;
  const scaled = amount * factor;
  // `Math.round` breaks ties toward +Infinity, which rounds -0.005 to -0.00 and 0.005 to 0.01:
  // the same magnitude rounds two different ways depending on sign. Rounding the magnitude and
  // reapplying the sign keeps a credit and its mirroring debit the same size.
  return Math.sign(scaled) * Math.round(Math.abs(scaled));
}

/** Back to a unit amount with exactly `scale` decimals. */
export function fromCents(cents: number, scale = 2): number {
  return cents / 10 ** scale;
}

/** An amount snapped to the currency's minor unit, so no unrounded product reaches a column. */
export function roundAmount(amount: number, scale = 2): number {
  return fromCents(toCents(amount, scale), scale);
}

/** Sum in cents, so a long column of amounts cannot accumulate binary drift. */
export function sumAmounts(amounts: readonly number[], scale = 2): number {
  return fromCents(
    amounts.reduce((total, amount) => total + toCents(amount, scale), 0),
    scale,
  );
}

/**
 * Convert `amount` from a currency into the ledger's currency at `rate`, rounded to the minor unit.
 *
 * `rate` is always expressed as "units of the target currency for one unit of the source", so the
 * conversion is a multiplication and the direction cannot be read backwards. A rate stored the
 * other way round must be inverted by its caller before it gets here — which is the mistake this
 * signature exists to make visible.
 */
export function convert(amount: number, rate: number, scale = 2): number {
  return roundAmount(amount * rate, scale);
}
