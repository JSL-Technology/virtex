/**
 * How the DGII writes a field in a «formato de envío», stated once.
 *
 * * Fields are pipe-delimited, one record per line, no trailing delimiter.
 * * Dates are `AAAAMMDD`; a period is `AAAAMM`.
 * * Amounts carry two decimals with a dot separator and no thousands separator.
 * * An amount of zero is written as `0.00`; an inapplicable text field is left empty.
 * * The first line is the header the DGII expects for the format.
 */
import type { ReturnPeriod } from '../../contracts';

/** `AAAAMM` for the report period. */
export function dgiiPeriod(period: ReturnPeriod): string {
  return `${period.year}${String(period.month).padStart(2, '0')}`;
}

/** `AAAAMMDD` from a `YYYY-MM-DD` date. */
export function compactDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, '');
}

/** Two decimals, dot separator, no thousands separator. */
export function money(value: number): string {
  return round2(value ?? 0).toFixed(2);
}

export function round2(value: number): number {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/** 1 = RNC (9 digits), 2 = Cédula (11 digits), 3 = anything else (passport, foreign id). */
export function identificationType(taxId: string): string {
  if (taxId.length === 9) return '1';
  if (taxId.length === 11) return '2';
  return taxId ? '3' : '';
}

/**
 * The header every format carries: its own number, the filer's RNC, the period and the record
 * count. A previous version carried a fifth field (a total) the published header does not have.
 */
export function header(format: string, taxId: string, period: ReturnPeriod, records: number): string {
  return [format, digitsOnly(taxId), dgiiPeriod(period), String(records)].join('|');
}

/** The file: the header, then one line per record. */
export function fileOf(format: string, taxId: string, period: ReturnPeriod, rows: readonly string[]): { file: string; records: number } {
  return { file: [header(format, taxId, period, rows.length), ...rows].join('\n'), records: rows.length };
}

/** `DGII_607_202606.txt`: what the file is called when a person downloads it. */
export function fileName(format: string, period: ReturnPeriod): string {
  return `DGII_${format}_${dgiiPeriod(period)}.txt`;
}
