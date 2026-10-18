import { formatTaxId } from './tax-id-format';
import { relativeWait } from './relative-wait';

/** QA A-02: the profile showed the stored EIN `129007988` instead of `12-9007988`. */
describe('formatTaxId', () => {
  it('writes a stored identifier with its country\'s separators', () => {
    expect(formatTaxId('129007988', '12-3456789')).toBe('12-9007988');
    expect(formatTaxId('00112345673', '001-1234567-3')).toBe('001-1234567-3');
  });

  it('leaves an identifier that does not fit the mask exactly as stored', () => {
    expect(formatTaxId('DEM010203AB5', '12-3456789')).toBe('DEM010203AB5');
    expect(formatTaxId('12345', '12-3456789')).toBe('12345');
  });

  it('keeps alphanumeric identifiers whose example has no separators', () => {
    expect(formatTaxId('DEM010203AB5', 'DEM010203AB5')).toBe('DEM010203AB5');
  });

  it('is empty for an empty value', () => {
    expect(formatTaxId(null, '12-3456789')).toBe('');
  });
});

describe('relativeWait', () => {
  it('says the wait in the reader\'s language, rounded up to the unit shown', () => {
    expect(relativeWait(61, 'en-US')).toBe('in 2 minutes');
    expect(relativeWait(30, 'en-US')).toBe('in 30 seconds');
    expect(relativeWait(900, 'es')).toBe('dentro de 15 minutos');
  });
});
