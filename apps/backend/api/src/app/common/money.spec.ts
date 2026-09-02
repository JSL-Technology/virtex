import {
  MoneyError,
  convert,
  fromCents,
  requireFiniteAmount,
  roundAmount,
  sumAmounts,
  toCents,
} from './money';

/**
 * The arithmetic that decides whether a journal entry balances.
 *
 * The check this replaces was `Math.abs(totalDebit - totalCredit) > 0.01`. Both halves of that were
 * wrong, and both are covered here: a one-cent imbalance is a real imbalance, and a total that is
 * not a number must not pass a threshold comparison by accident.
 */
describe('money', () => {
  describe('requireFiniteAmount', () => {
    it.each([
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['undefined', undefined],
      ['null', null],
      ['a non-numeric string', 'not a number'],
      // The exact shape produced by `0 + "1500.00" + "200.00"` when a `numeric` column arrives
      // as a string and the code adds rather than concatenates deliberately.
      ['a concatenated numeric string', '01500.00200.00'],
    ])('rejects %s', (_label, value) => {
      expect(() => requireFiniteAmount(value, 'debit')).toThrow(MoneyError);
    });

    it('accepts a numeric string, because that is what a numeric column yields', () => {
      expect(requireFiniteAmount('1500.00', 'debit')).toBe(1500);
    });

    it('rejects an amount beyond exact integer representation', () => {
      expect(() => requireFiniteAmount(1e15, 'debit')).toThrow(MoneyError);
    });
  });

  describe('toCents', () => {
    it('is exact for amounts that binary floating point is not', () => {
      // 0.1 + 0.2 !== 0.3 in IEEE-754; in cents it is 10 + 20 === 30.
      expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));
    });

    it('rounds a half-cent away from zero in both directions', () => {
      // `Math.round` breaks ties toward +Infinity, so 0.005 and -0.005 would round to different
      // magnitudes and a credit would not mirror its debit.
      expect(toCents(0.005)).toBe(1);
      expect(toCents(-0.005)).toBe(-1);
    });

    it('round-trips through fromCents', () => {
      for (const amount of [0, 0.01, 1234.56, -98.76, 1_000_000.99]) {
        expect(fromCents(toCents(amount))).toBeCloseTo(amount, 10);
      }
    });

    it('handles a currency with no minor unit exactly', () => {
      // CLP and PYG are whole units; the round trip must not invent decimals.
      expect(fromCents(toCents(150000, 0), 0)).toBe(150000);
    });
  });

  describe('sumAmounts', () => {
    it('does not accumulate drift over a long column of amounts', () => {
      const hundredCents = Array.from({ length: 100 }, () => 0.01);
      expect(sumAmounts(hundredCents)).toBe(1);
    });

    it('sums a mixed column exactly', () => {
      expect(sumAmounts([1234.56, -1000, -234.56])).toBe(0);
    });
  });

  describe('roundAmount', () => {
    it('snaps an unrounded product to the minor unit', () => {
      // 1234.56 * 1.0000001 is the kind of value an FX conversion produces.
      expect(roundAmount(1234.56 * 1.0000001)).toBe(1234.56);
    });
  });

  describe('convert', () => {
    it('multiplies by the rate and rounds once', () => {
      // 100 USD at 58.75 DOP per USD.
      expect(convert(100, 58.75)).toBe(5875);
    });

    it('is the inverse of the opposite rate, to the cent', () => {
      const dopPerUsd = 58.75;
      const usd = 100;
      const dop = convert(usd, dopPerUsd);
      expect(convert(dop, 1 / dopPerUsd)).toBe(usd);
    });
  });

  describe('the balance check this arithmetic exists for', () => {
    const balances = (debits: number[], credits: number[]) =>
      debits.reduce((t, d) => t + toCents(d), 0) ===
      credits.reduce((t, c) => t + toCents(c), 0);

    it('accepts an entry that balances exactly', () => {
      expect(balances([100.5, 49.5], [150])).toBe(true);
    });

    it('rejects a one-cent imbalance that the old tolerance accepted', () => {
      expect(balances([100.0], [99.99])).toBe(false);
    });

    it('rejects totals that are not numbers, instead of comparing false', () => {
      // The old form: `Math.abs(NaN - NaN) > 0.01` is false, so the entry was "balanced".
      expect(Math.abs(NaN - NaN) > 0.01).toBe(false);
      expect(() => requireFiniteAmount(NaN, 'debit')).toThrow(MoneyError);
    });
  });
});
