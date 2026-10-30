import { mergeRegionalFormats, normaliseRegionalFormat, isRegionalFormatValue } from './regional-format.contract';

describe('regional format contract', () => {
  it('keeps only known fields with known values', () => {
    expect(
      normaliseRegionalFormat({ dateOrder: 'MDY', numberFormat: 'semicolon', timeFormat: null, colour: 'red', firstDayOfWeek: 1 }),
    ).toEqual({ dateOrder: 'MDY', firstDayOfWeek: 1 });
    expect(normaliseRegionalFormat('MDY')).toEqual({});
    expect(normaliseRegionalFormat(null)).toEqual({});
  });

  it('resolves field by field: the person over the company, the rest left to the locale', () => {
    const company = { numberFormat: 'dot_comma', dateOrder: 'DMY' } as const;
    const person = { dateOrder: 'YMD', timeFormat: 'h23' } as const;
    expect(mergeRegionalFormats(person, company)).toEqual({ dateOrder: 'YMD', timeFormat: 'h23', numberFormat: 'dot_comma' });
    expect(mergeRegionalFormats(null, undefined)).toEqual({});
  });

  it('accepts «automatic» for every field', () => {
    expect(isRegionalFormatValue('numberFormat', null)).toBe(true);
    expect(isRegionalFormatValue('firstDayOfWeek', 3)).toBe(false);
  });
});
