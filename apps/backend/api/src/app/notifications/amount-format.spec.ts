import { formatAmount } from './amount-format';

describe('notice amounts (QA R3-M09)', () => {
  it('reads as the company writes it: the reader language and the company country', () => {
    expect(formatAmount(1475, 'es', 'DOP', 'DO')).toBe('RD$1,475.00');
    expect(formatAmount(1475, 'en', 'USD', 'US')).toBe('$1,475.00');
  });

  it('falls back to the plain figure for a currency it does not know', () => {
    expect(formatAmount(1475, 'es', 'NOPE', 'DO')).toMatch(/1.?475,00|1,475\.00/);
  });
});
