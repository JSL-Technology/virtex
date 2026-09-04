/**
 * Turning a report into a file an accountant can open.
 *
 * ## Why this exists at all
 *
 * The financial statements could not be exported. The balance sheet even carried a download icon —
 * `FileDown` — on a button whose handler was `load()`, so the one affordance that looked like an
 * export refreshed the page instead. For a product sold to accountants, a trial balance that
 * cannot leave the screen is a trial balance that gets retyped into a spreadsheet.
 *
 * ## Why CSV, and why it is not as simple as joining commas
 *
 * CSV because it opens in Excel, in Google Sheets, in LibreOffice and in whatever the client's
 * accountant already uses, with no library and no server round trip. Three details decide whether
 * it actually opens correctly, and all three are the ones people skip:
 *
 * 1. **The byte-order mark.** Excel on Windows reads a BOM-less file as the system's legacy
 *    code page, so `Depreciación` arrives as `DepreciaciÃ³n` for every reader in this product's
 *    markets. The three bytes are not optional.
 * 2. **The delimiter.** In locales where the decimal separator is a comma — Spanish, Portuguese —
 *    Excel's CSV import expects a semicolon, and a comma-delimited file lands entirely in column
 *    A. The separator has to follow the reader's locale, and `sep=` on the first line is what tells
 *    Excel which one was chosen.
 * 3. **Quoting.** An account named `Gastos, generales` or a description containing a newline or a
 *    quotation mark breaks the row unless it is quoted and its quotes doubled.
 *
 * ## Numbers stay numbers
 *
 * Amounts are written unformatted, with a dot as the decimal separator, and the separator line
 * tells the spreadsheet how to read them. Writing `1.234,56` because the reader is Spanish
 * produces a *text* cell that nobody can sum — which is the opposite of what an export is for.
 */

/** A cell can be any of these; everything else is a bug at the call site. */
export type CsvValue = string | number | boolean | null | undefined;

export interface CsvExportOptions {
  /**
   * The reader's locale, used only to choose the delimiter.
   *
   * Not to format numbers: a locale-formatted amount is text, and text does not add up.
   */
  locale?: string;
  /** Rows written above the table: title, period, ledger, currency. */
  preamble?: CsvValue[][];
}

/** Locales whose decimal separator is a comma, and whose Excel therefore expects a semicolon. */
function delimiterFor(locale: string): ';' | ',' {
  const decimal = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal')?.value;
  return decimal === ',' ? ';' : ',';
}

/** One cell, quoted only when it has to be. */
function cell(value: CsvValue, delimiter: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    // `Infinity` and `NaN` are not amounts, and writing them into a financial statement is worse
    // than writing nothing: a reader cannot tell them from a real figure at a glance.
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const text = String(value);
  const needsQuotes =
    text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r');
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The complete CSV text, BOM included, ready to be written to a file. */
export function toCsv(rows: CsvValue[][], options: CsvExportOptions = {}): string {
  const locale = options.locale || 'es';
  const delimiter = delimiterFor(locale);

  const lines = [...(options.preamble ?? []), ...rows].map((row) =>
    row.map((value) => cell(value, delimiter)).join(delimiter),
  );

  // `sep=` must be the very first line, and Excel is the only reader that acts on it; everything
  // else treats it as an ordinary row, which is why the preamble carries the title anyway.
  return `﻿sep=${delimiter}\r\n${lines.join('\r\n')}\r\n`;
}

/**
 * Hand the file to the browser.
 *
 * Revoking the object URL matters: without it each export leaks the whole file for the lifetime of
 * the tab, and a user comparing twelve months of statements exports twelve of them.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * A filename that sorts chronologically and survives every filesystem.
 *
 * `Balance general al 31/12/2026.csv` contains slashes. On Windows that is not a filename; in a
 * download it is silently mangled.
 */
export function reportFilename(base: string, ...parts: (string | undefined)[]): string {
  const slug = [base, ...parts.filter(Boolean)]
    .join('-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${slug}.csv`;
}
