import { parseDecimal } from './parse-decimal';

/**
 * Reading a number a human wrote.
 *
 * Every case below was `parseFloat` in the journal-entry importer, and `parseFloat` answers most
 * of them with a plausible number rather than an error — which is what let an entry off by a
 * factor of a thousand into the ledger, still balanced, because both of its sides were divided by
 * the same thousand.
 */
describe('parseDecimal', () => {
  describe('with a comma decimal separator (most of Latin America)', () => {
    it.each([
      ['1.234,56', 1234.56],
      ['58.750,00', 58750],
      ['0,05', 0.05],
      ['1.000.000,00', 1000000],
      ['-1.234,56', -1234.56],
      ['(1.234,56)', -1234.56],
      ['RD$ 1.234,56', 1234.56],
      ['1 234,56', 1234.56],
      ['500', 500],
    ])('reads %s as %d', (raw, expected) => {
      expect(parseDecimal(raw, ',')).toBe(expected);
    });

    /** `parseFloat('1.234,56')` is 1.234 — three orders of magnitude out, and silently. */
    it('is not parseFloat', () => {
      expect(parseFloat('1.234,56')).toBe(1.234);
      expect(parseDecimal('1.234,56', ',')).toBe(1234.56);
    });
  });

  describe('with a period decimal separator (the United States and Mexico)', () => {
    it.each([
      ['1,234.56', 1234.56],
      ['58,750.00', 58750],
      ['0.05', 0.05],
      ['-1,234.56', -1234.56],
      ['(1,234.56)', -1234.56],
      ['$ 1,234.56', 1234.56],
      ['500', 500],
    ])('reads %s as %d', (raw, expected) => {
      expect(parseDecimal(raw, '.')).toBe(expected);
    });

    it('is not parseFloat', () => {
      expect(parseFloat('1,234.56')).toBe(1);
      expect(parseDecimal('1,234.56', '.')).toBe(1234.56);
    });
  });

  /**
   * A blank debit or credit is not an error: a ledger export leaves one of the pair blank on every
   * row, and rejecting that would reject every well-formed file.
   */
  it.each(['', '   ', '-', null, undefined])('reads %p as zero', (raw) => {
    expect(parseDecimal(raw, ',')).toBe(0);
  });

  /**
   * A value that is present and unreadable is `null`, where `parseFloat` produced a number.
   */
  it.each([
    ['abc', 'text'],
    ['12abc', 'a number with text after it — parseFloat says 12'],
    ['1.234.56', 'two separators, so the declared convention does not fit the file'],
    ['$', 'a currency symbol on its own'],
    ['--5', 'two signs'],
  ])('refuses %s (%s)', (raw) => {
    expect(parseDecimal(raw, '.')).toBeNull();
  });

  it('refuses 12abc where parseFloat answers 12', () => {
    expect(parseFloat('12abc')).toBe(12);
    expect(parseDecimal('12abc', '.')).toBeNull();
  });

  it('passes a number straight through, and refuses one that is not finite', () => {
    expect(parseDecimal(1234.56, ',')).toBe(1234.56);
    expect(parseDecimal(Number.NaN, ',')).toBeNull();
    expect(parseDecimal(Number.POSITIVE_INFINITY, ',')).toBeNull();
  });
});
