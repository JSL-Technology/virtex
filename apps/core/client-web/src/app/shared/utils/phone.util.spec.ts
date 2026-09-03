import { toE164, isValidPhone, formatNational, regionForE164, callingCodeForRegion } from './phone.util';

describe('phone.util', () => {
  describe('toE164', () => {
    it('normalizes a national number to E.164 using the region', () => {
      // 202-456-1414 (a real, valid US number) typed nationally.
      expect(toE164('202-456-1414', 'US')).toBe('+12024561414');
      expect(toE164('(202) 456 1414', 'us')).toBe('+12024561414');
    });

    it('accepts an already-international number and ignores the region', () => {
      expect(toE164('+1 202 456 1414', 'MX')).toBe('+12024561414');
    });

    it('normalizes a Dominican number under the +1 NANP region', () => {
      // 809-234-5678 is a well-formed DO number; the region disambiguates +1.
      const result = toE164('809-234-5678', 'DO');
      expect(result).toBe('+18092345678');
    });

    it('returns null for empty, junk, or too-short input', () => {
      expect(toE164('', 'US')).toBeNull();
      expect(toE164(null, 'US')).toBeNull();
      expect(toE164(undefined, 'US')).toBeNull();
      expect(toE164('abc', 'US')).toBeNull();
      expect(toE164('123', 'US')).toBeNull();
    });

    it('returns null when the number is not valid for the region', () => {
      // A US-format string but an impossible number.
      expect(toE164('000-000-0000', 'US')).toBeNull();
    });
  });

  describe('isValidPhone', () => {
    it('is true for a valid number and false otherwise', () => {
      expect(isValidPhone('202-456-1414', 'US')).toBe(true);
      expect(isValidPhone('123', 'US')).toBe(false);
      expect(isValidPhone('', 'US')).toBe(false);
    });
  });

  describe('formatNational', () => {
    it('renders E.164 back to a national display string', () => {
      expect(formatNational('+12024561414', 'US')).toBe('(202) 456-1414');
    });

    it('falls back to the raw input when it cannot be parsed', () => {
      expect(formatNational('not-a-number', 'US')).toBe('not-a-number');
    });
  });

  describe('regionForE164', () => {
    it('resolves the region of a valid E.164 number', () => {
      expect(regionForE164('+12024561414')).toBe('US');
      expect(regionForE164('+18092345678')).toBe('DO');
    });

    it('returns null for undeterminable input', () => {
      expect(regionForE164('')).toBeNull();
      expect(regionForE164('abc')).toBeNull();
    });
  });

  describe('callingCodeForRegion', () => {
    it('returns the numeric calling code for a region', () => {
      expect(callingCodeForRegion('US')).toBe('1');
      expect(callingCodeForRegion('do')).toBe('1');
      expect(callingCodeForRegion('MX')).toBe('52');
    });

    it('returns an empty string for an unknown region', () => {
      expect(callingCodeForRegion('ZZ')).toBe('');
      expect(callingCodeForRegion('')).toBe('');
    });
  });
});
