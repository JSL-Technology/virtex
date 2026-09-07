import { minorUnitsFor } from '../currencies/currency-catalogue';

/**
 * Money arithmetic for the ledger. The only place in the backend that rounds an amount.
 *
 * ## Why integer minor units
 *
 * The balance check used to be `Math.abs(totalDebit - totalCredit) > 0.01`, which is wrong twice
 * over. It accepts a real one-cent imbalance, so a ledger could be posted permanently out of
 * balance by a cent per entry and nothing would ever report it. And because `NaN > 0.01` is
 * `false`, it accepts an entry whose totals are not numbers at all — which is how a debit of
 * `"01500.00200.00"`, produced by string concatenation over untransformed `numeric` columns, was
 * accepted as balanced.
 *
 * Summing in integer minor units removes both. Every amount a ledger deals in is a whole number of
 * minor units, integers up to 2^53 are exact in IEEE-754, and an exact comparison against zero
 * replaces a tolerance that was hiding errors rather than absorbing them.
 *
 * Note what is *not* claimed: a decimal amount is **not** exactly representable in a double.
 * `1180.10` is not; `0.1 + 0.2` is not `0.3`. What is exact is the integer that results from
 * scaling and rounding it. Every operation here therefore converts to integer minor units, works
 * there, and converts back exactly once. Nothing accumulates in units.
 *
 * ## One rounding convention
 *
 * **Half away from zero**, everywhere, for every currency. It is the rule tax authorities state,
 * and it is the only convention under which a credit and the debit that mirrors it come out the
 * same size: `Math.round` breaks ties toward +Infinity, so it turns 0.005 into 0.01 and -0.005
 * into -0.00, and a reversal then fails to reverse.
 *
 * There used to be eight other implementations of this — `roundToCurrency` in the tax engine and
 * six copies of `round2`, all spelled `Math.round((value + Number.EPSILON) * 100) / 100`. That
 * idiom is inert: `Number.EPSILON` is 2.22e-16 while the ulp of a value of order 1000 is 2.27e-13,
 * so the addition changes nothing at any magnitude money is measured in. It also rounds half
 * toward +Infinity, so the ledger and the e-CF XML rounded the same negative amount two different
 * ways. All of them now delegate here.
 *
 * ## Scale
 *
 * Every function takes either an ISO 4217 code or an explicit scale. Prefer the code: Chilean and
 * Paraguayan amounts carry no decimals and rounding them to two produces totals the SII and the
 * SET reject, and the three-decimal dinars exist. The ledger's own columns are `scale: 2`, so
 * `scale` defaults to 2 where no currency is in scope — that is a storage fact, not a currency one.
 */

/** The largest amount this module handles exactly: 2^53 minor units, about 90 trillion units. */
const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {}

/**
 * A finite number, or a throw.
 *
 * Every amount entering the ledger passes through here. `NaN`, `Infinity`, `null`, `undefined` and
 * strings that do not parse are rejected at the boundary rather than propagating into a total that
 * silently compares false against every threshold.
 */
export function requireFiniteAmount(value: unknown, field: string): number {
  // `Number(null)` and `Number('')` are both 0, which is finite — so a missing amount would pass a
  // finiteness check and be booked as zero. An absent figure is not a zero figure.
  if (value === null || value === undefined || value === '') {
    throw new MoneyError(`${field} is required`);
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new MoneyError(
      `${field} must be a finite number, received ${JSON.stringify(value)}`,
    );
  }
  if (Math.abs(parsed) * 100 > MAX_SAFE_MINOR) {
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

/**
 * Back to a unit amount with exactly `scale` decimals.
 *
 * Normalises negative zero. IEEE-754 keeps the sign through `-0 / 100`, and `Object.is(-0, 0)` is
 * false, so a zero balance produced by a subtraction compares unequal to a zero produced by a
 * literal — which reads as a difference in a report that is asserting there is none.
 */
export function fromCents(cents: number, scale = 2): number {
  const amount = cents / 10 ** scale;
  return amount === 0 ? 0 : amount;
}

/** An amount snapped to the currency's minor unit, so no unrounded product reaches a column. */
export function roundAmount(amount: number, scale = 2): number {
  return fromCents(toCents(amount, scale), scale);
}

/** Sum in minor units, so a long column of amounts cannot accumulate binary drift. */
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

// ─────────────────────────────────────────────────────────────────────────────
// Currency-aware forms. Prefer these wherever an ISO code is in scope.
// ─────────────────────────────────────────────────────────────────────────────

/** Integer minor units of `currencyCode`: CLP and PYG have none, the dinars have three. */
export function toMinorUnits(amount: number, currencyCode: string): number {
  return toCents(amount, minorUnitsFor(currencyCode));
}

/** Minor units of `currencyCode` back to a unit amount. */
export function fromMinorUnits(minor: number, currencyCode: string): number {
  return fromCents(minor, minorUnitsFor(currencyCode));
}

/**
 * Round to the number of decimals the currency is actually expressed in.
 *
 * This is the function the tax engine, the e-CF builders and the fiscal reports all call. It used
 * to live in `sales-tax.engine.ts` with a different tie-breaking rule from the ledger's; having one
 * implementation is what guarantees the printed document, the ledger entry, the QR code and the
 * transmitted XML carry the same number.
 */
export function roundToCurrency(value: number, currencyCode: string): number {
  return roundAmount(value, minorUnitsFor(currencyCode));
}

/** Sum a column of amounts in one currency, in that currency's minor units. */
export function sumInCurrency(
  amounts: readonly number[],
  currencyCode: string,
): number {
  return sumAmounts(amounts, minorUnitsFor(currencyCode));
}

/** Convert into `targetCurrency` at `rate`, rounded to that currency's minor unit. */
export function convertToCurrency(
  amount: number,
  rate: number,
  targetCurrency: string,
): number {
  return convert(amount, rate, minorUnitsFor(targetCurrency));
}

/**
 * Distribute `total` across `weights` so the parts sum back to `total` exactly.
 *
 * A document-level discount, a freight charge apportioned over lines, a tax base allocated across
 * buckets: rounding each share independently leaves a residue of a minor unit or two, and dropping
 * it is how an invoice total stops matching the sum of its lines. The largest-remainder method
 * hands the residue to the shares that lost the most to rounding, so the result is both exact and
 * stable — the same inputs always produce the same allocation.
 *
 * Returns amounts in units of `currencyCode`, in the order of `weights`. A zero total, or weights
 * that sum to zero, allocates zero to every share rather than dividing by zero.
 */
export function allocate(
  total: number,
  weights: readonly number[],
  currencyCode: string,
): number[] {
  const scale = minorUnitsFor(currencyCode);
  const totalMinor = toCents(total, scale);
  if (weights.length === 0) return [];

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalMinor === 0 || weightSum === 0) return weights.map(() => 0);

  const exact = weights.map((weight) => (totalMinor * weight) / weightSum);
  const floors = exact.map((value) => Math.floor(value));
  let residue = totalMinor - floors.reduce((sum, value) => sum + value, 0);

  // Largest remainder first; ties broken by position so the allocation is deterministic.
  const order = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const allocated = [...floors];
  for (let i = 0; residue > 0 && i < order.length; i += 1) {
    allocated[order[i].index] += 1;
    residue -= 1;
  }
  // A negative total (a credit note's discount) leaves residue negative; take from the smallest
  // remainders instead, walking the same deterministic order backwards.
  for (let i = order.length - 1; residue < 0 && i >= 0; i -= 1) {
    allocated[order[i].index] -= 1;
    residue += 1;
  }

  return allocated.map((minor) => fromCents(minor, scale));
}
