/**
 * RFC 4180 CSV, safe to open in a spreadsheet.
 *
 * Document numbers, party names and memos are user-entered text, and a spreadsheet executes a cell
 * that starts with `=`, `+`, `-`, `@` (or a tab / carriage return) as a formula — the classic CSV
 * injection. Such cells are prefixed with an apostrophe, which spreadsheets render as plain text.
 * Numbers are written as numbers, so negative amounts stay numeric.
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
