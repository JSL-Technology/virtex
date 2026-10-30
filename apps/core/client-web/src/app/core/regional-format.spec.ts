import { TestBed } from '@angular/core/testing';
import { FormatService, LocaleStore, parseLocalizedDate, parseLocalizedNumber } from '@virteex/shared/ui-i18n';
import { LocaleContextContract, RegionalFormat } from '@virteex/shared/types';

/**
 * Dates, numbers and times as the company or the person chose them (CG-29 / CG-30, and the
 * question «¿puede el usuario configurar el formato de fechas y los separadores decimales?» — it
 * could not: every format was CLDR's for the language in the company's country).
 *
 * Here rather than beside the service for the reason `calendar-date.spec.ts` gives.
 */
describe('regional format', () => {
  let format: FormatService;
  let store: LocaleStore;

  const context = (companyFormat: RegionalFormat | null = null, personalFormat: RegionalFormat | null = null): LocaleContextContract => ({
    language: 'es',
    locale: 'es-DO',
    direction: 'ltr',
    countryCode: 'DO',
    currency: 'DOP',
    timezone: 'America/Santo_Domingo',
    booksLanguage: 'es',
    firstDayOfWeek: 0,
    companyFormat,
    personalFormat,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [FormatService, LocaleStore] });
    format = TestBed.inject(FormatService);
    store = TestBed.inject(LocaleStore);
    store.setLanguage('es');
  });

  it('follows the locale when nobody chose anything', () => {
    store.setTenantContext(context());
    expect(format.number(1234.5, '1.2-2')).toBe('1,234.50');
    expect(format.date('2026-09-14')).toBe('14/09/2026');
  });

  it('writes the company’s decimal comma in numbers, money and percentages alike', () => {
    store.setTenantContext(context({ numberFormat: 'dot_comma' }));
    expect(format.number(1234567.5, '1.2-2')).toBe('1.234.567,50');
    expect(format.money(1234.5, 'DOP')).toMatch(/1\.234,50/);
    expect(format.percent(0.125, '1.1-1')).toMatch(/12,5/);
  });

  it('lets the person override the company, field by field', () => {
    store.setTenantContext(context({ numberFormat: 'dot_comma', dateOrder: 'DMY' }, { dateOrder: 'YMD', dateSeparator: '-' }));
    expect(format.date('2026-09-14')).toBe('2026-09-14');
    // The number format is still the company's.
    expect(format.number(1.5, '1.1-1')).toBe('1,5');
  });

  it('orders a timestamp’s date the same way, and uses the chosen clock', () => {
    store.setTenantContext(context(null, { dateOrder: 'MDY', timeFormat: 'h23' }));
    expect(format.date('2026-09-14T18:30:00Z', 'dateTime')).toBe('09/14/2026 14:30');
    store.setPersonalFormat({ timeFormat: 'h12' });
    expect(format.date('2026-09-14T18:30:00Z', 'time')).toMatch(/2:30/);
  });

  it('applies a change made in this session at once, and a fresh session replaces it', () => {
    store.setTenantContext(context());
    store.setPersonalFormat({ numberFormat: 'space_comma' });
    expect(format.number(1234.5, '1.1-1')).toBe('1 234,5');
    store.setTenantContext(context());
    expect(format.number(1234.5, '1.1-1')).toBe('1,234.5');
  });

  it('shows and reads a date field in the order in force', () => {
    store.setTenantContext(context(null, { dateOrder: 'MDY', dateSeparator: '/' }));
    expect(format.dateForInput('2026-09-14')).toBe('09/14/2026');
    expect(format.parseDate('9/14/2026')).toBe('2026-09-14');
    expect(format.parseDate('14/09/2026')).toBeNull();
    expect(format.datePlaceholder({ day: 'd', month: 'm', year: 'a' })).toBe('mm/dd/aaaa');
  });

  it('shows and reads a number field with the decimal mark in force', () => {
    store.setTenantContext(context({ numberFormat: 'dot_comma' }));
    expect(format.numberForInput(1234.5)).toBe('1234,5');
    expect(format.parseNumber('1.234,5')).toBe(1234.5);
    expect(format.parseNumber('1234,5')).toBe(1234.5);
  });
});

describe('parseLocalizedNumber', () => {
  const dot = { group: ',', decimal: '.' };
  const comma = { group: '.', decimal: ',' };

  it.each([
    ['1234.56', dot, 1234.56],
    ['1,234.56', dot, 1234.56],
    ['-1 234.5', dot, -1234.5],
    ['.5', dot, 0.5],
    ['1.234,56', comma, 1234.56],
    ['−12,5', comma, -12.5],
    ['1’234.5', { group: '’', decimal: '.' }, 1234.5],
  ])('reads %s', (text, symbols, expected) => {
    expect(parseLocalizedNumber(text, symbols)).toBe(expected);
  });

  it.each([
    ['1,5', dot],
    ['1.5', comma],
    ['12,34.5', dot],
    ['1.2.3', dot],
    ['abc', dot],
    ['1e5', dot],
  ])('refuses %s rather than guess', (text, symbols) => {
    expect(parseLocalizedNumber(text, symbols)).toBeNull();
  });

  it('reads an empty field as no number', () => {
    expect(parseLocalizedNumber('  ', dot)).toBeNull();
  });
});

describe('parseLocalizedDate', () => {
  it('reads each order, any separator, and a two-digit year', () => {
    expect(parseLocalizedDate('14/9/2026', 'DMY')).toBe('2026-09-14');
    expect(parseLocalizedDate('9-14-26', 'MDY')).toBe('2026-09-14');
    expect(parseLocalizedDate('2026.09.14', 'YMD')).toBe('2026-09-14');
  });

  it('takes an ISO date whatever the order, because it cannot be misread', () => {
    expect(parseLocalizedDate('2026-09-14', 'MDY')).toBe('2026-09-14');
  });

  it('refuses a date that does not exist instead of rolling it over', () => {
    expect(parseLocalizedDate('31/02/2026', 'DMY')).toBeNull();
    expect(parseLocalizedDate('14/13/2026', 'DMY')).toBeNull();
    expect(parseLocalizedDate('14/09', 'DMY')).toBeNull();
  });
});
