import { JournalEntriesService } from './journal-entries.service';

/**
 * XF-09 (audit 2026-11-07): the stated rate of a foreign-currency entry went through the cents
 * rounding of an amount, so 58.4567 reached the tolerance check as 58.46 and 0.0042 (COP→USD) as 0,
 * refused as non-positive.
 */
describe('a stated exchange rate on a journal entry', () => {
  const service = Object.create(JournalEntriesService.prototype) as unknown as { rate(value: unknown): number };

  it('keeps the six decimals of the column', () => {
    expect(service.rate(58.456789)).toBe(58.456789);
    expect(service.rate('0.0042')).toBe(0.0042);
    expect(service.rate(1.23456789)).toBe(1.234568);
  });

  it('still refuses what is not a number', () => {
    expect(() => service.rate('abc')).toThrow();
  });
});

