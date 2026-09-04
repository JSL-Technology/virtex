import { reportFilename, toCsv } from './csv-export';

/**
 * The three details that decide whether an exported statement opens correctly.
 *
 * None of them are visible in a code review of the happy path, and all three produce a file that
 * *looks* fine to whoever generated it and is unusable to whoever receives it — which is the whole
 * population an export exists for.
 */
describe('CSV export', () => {
  /**
   * Excel on Windows reads a BOM-less file as the system's legacy code page, so `Depreciación`
   * arrives as `DepreciaciÃ³n` for every reader in this product's markets.
   */
  it('opens with a byte-order mark', () => {
    expect(toCsv([['Depreciación']])).toMatch(/^﻿/);
  });

  /**
   * In locales whose decimal separator is a comma, Excel's CSV import expects a semicolon. A
   * comma-delimited file lands entirely in column A.
   */
  it('uses a semicolon where the decimal separator is a comma', () => {
    const csv = toCsv([['a', 'b']], { locale: 'es' });
    expect(csv).toContain('sep=;');
    expect(csv).toContain('a;b');
  });

  it('uses a comma where the decimal separator is a dot', () => {
    const csv = toCsv([['a', 'b']], { locale: 'en-US' });
    expect(csv).toContain('sep=,');
    expect(csv).toContain('a,b');
  });

  /**
   * Amounts stay machine-readable.
   *
   * Formatting `1234.56` as `1.234,56` because the reader is Spanish produces a *text* cell that
   * cannot be summed, which is the opposite of what an export is for. The `sep=` line is what tells
   * the spreadsheet how to read the file.
   */
  it('writes amounts unformatted so they arrive as numbers', () => {
    expect(toCsv([[1234.56]], { locale: 'es' })).toContain('1234.56');
    expect(toCsv([[1234.56]], { locale: 'es' })).not.toContain('1.234,56');
  });

  it('writes nothing rather than a figure a reader cannot distinguish from data', () => {
    const csv = toCsv([[Number.NaN, Number.POSITIVE_INFINITY, 0]], { locale: 'en-US' });
    expect(csv).toContain(',,0');
  });

  // ── Quoting ────────────────────────────────────────────────────────────────

  it('quotes a value containing the delimiter', () => {
    expect(toCsv([['Gastos, generales']], { locale: 'en-US' })).toContain('"Gastos, generales"');
  });

  it('doubles the quotes inside a quoted value', () => {
    expect(toCsv([['Cuenta "principal"']], { locale: 'en-US' })).toContain(
      '"Cuenta ""principal"""',
    );
  });

  it('quotes a value containing a newline', () => {
    expect(toCsv([['línea uno\nlínea dos']], { locale: 'en-US' })).toContain(
      '"línea uno\nlínea dos"',
    );
  });

  it('leaves an ordinary value unquoted', () => {
    expect(toCsv([['Efectivo']], { locale: 'en-US' })).toContain('\r\nEfectivo\r\n');
  });

  it('writes an empty cell for a missing value', () => {
    expect(toCsv([[null, undefined, 'x']], { locale: 'en-US' })).toContain(',,x');
  });

  it('writes the preamble above the table', () => {
    const csv = toCsv([['Efectivo', 100]], {
      locale: 'en-US',
      preamble: [['Balance general'], ['Moneda', 'DOP'], []],
    });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('﻿sep=,');
    expect(lines[1]).toBe('Balance general');
    expect(lines[2]).toBe('Moneda,DOP');
    expect(lines[4]).toBe('Efectivo,100');
  });

  // ── Filenames ──────────────────────────────────────────────────────────────

  /**
   * `Balance general al 31/12/2026.csv` contains slashes. On Windows that is not a filename; in a
   * download it is silently mangled.
   */
  it('produces a filename that survives every filesystem', () => {
    expect(reportFilename('balance-general', '2026-12-31')).toBe(
      'balance-general-2026-12-31.csv',
    );
    expect(reportFilename('Balance General', '31/12/2026')).toBe(
      'balance-general-31-12-2026.csv',
    );
  });

  it('strips accents rather than emitting them into a filename', () => {
    expect(reportFilename('Ganancias y Pérdidas', '2026')).toBe('ganancias-y-perdidas-2026.csv');
  });

  it('skips the parts it was not given', () => {
    expect(reportFilename('flujo-de-efectivo', undefined, '2026-12-31')).toBe(
      'flujo-de-efectivo-2026-12-31.csv',
    );
  });
});
