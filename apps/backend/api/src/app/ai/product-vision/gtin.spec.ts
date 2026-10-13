import { checkGtin } from './gtin';

describe('checkGtin', () => {
  it.each([
    ['7501055363063', 'EAN-13'],
    ['036000291452', 'UPC-A'],
    ['96385074', 'EAN-8'],
    ['10614141000415', 'GTIN-14'],
  ])('accepts a well-formed %s (%s)', (code) => {
    expect(checkGtin(code)).toBe('valid');
  });

  it('catches a single misread digit', () => {
    // The commonest photo-reading error: one digit wrong, the check digit no longer agrees.
    expect(checkGtin('7501055363064')).toBe('invalid');
    expect(checkGtin('7501055368063')).toBe('invalid');
  });

  it('ignores spaces and dashes a label prints between groups', () => {
    expect(checkGtin('750 1055 36306 3')).toBe('valid');
    expect(checkGtin('0-36000-29145-2')).toBe('valid');
  });

  it('does not judge codes it cannot check', () => {
    expect(checkGtin(null)).toBe('unchecked');
    expect(checkGtin('')).toBe('unchecked');
    expect(checkGtin('ABC-123')).toBe('unchecked');
    expect(checkGtin('12345')).toBe('unchecked');
  });
});
