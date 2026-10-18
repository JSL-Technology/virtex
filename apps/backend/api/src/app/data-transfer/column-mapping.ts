import { DataTransferColumn } from '../contracts/data-transfer/data-transfer.contract';

/**
 * Matching a file's own headers to a dataset's keys, for files that were not made from the
 * template: «Nombre del cliente» → `name`, «RNC» → `tax_id`.
 *
 * Deterministic first: the key itself, written any way (`Tax ID`, `tax-id`, `TAX_ID`), or the key
 * with its words in another order. What that leaves unmatched may be proposed by the assistant,
 * constrained to the dataset's real keys (see DataTransferService.proposeMapping). Either way the
 * person confirms the mapping, and every row still passes the domain's own validation.
 */
export type ColumnMapping = Record<string, string | null>;

export function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const sortedWords = (value: string) => value.split('_').filter(Boolean).sort().join('_');

export function deterministicMapping(headers: string[], columns: readonly DataTransferColumn[]): ColumnMapping {
  const keys = columns.map((column) => column.key);
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  for (const header of headers) {
    const norm = normaliseHeader(header);
    const match = keys.find((key) => !taken.has(key) && (key === norm || sortedWords(key) === sortedWords(norm)));
    mapping[header] = match ?? null;
    if (match) taken.add(match);
  }
  return mapping;
}

/** The required keys no header is mapped to. */
export function missingRequired(mapping: ColumnMapping, columns: readonly DataTransferColumn[]): string[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return columns.filter((column) => column.required && !mapped.has(column.key)).map((column) => column.key);
}

/**
 * A confirmed mapping applied to a parsed file: headers renamed to keys, unmapped ones dropped.
 * Refuses a mapping that names a key the dataset does not have, or sends two headers to one key.
 */
export function applyMapping(
  headers: string[],
  rows: Array<Record<string, string>>,
  mapping: ColumnMapping,
  columns: readonly DataTransferColumn[],
): { headers: string[]; rows: Array<Record<string, string>>; problem: { key: string; params: Record<string, unknown> } | null } {
  const keys = new Set(columns.map((column) => column.key));
  const targets = new Map<string, string>();
  for (const header of headers) {
    const target = mapping[header] ?? mapping[header.toLowerCase()] ?? null;
    if (!target) continue;
    if (!keys.has(target)) return { headers, rows, problem: { key: 'data_transfer.mapping_unknown_key', params: { key: target } } };
    if ([...targets.values()].includes(target)) {
      return { headers, rows, problem: { key: 'data_transfer.mapping_duplicate_key', params: { key: target } } };
    }
    targets.set(header, target);
  }
  return {
    headers: [...targets.values()],
    rows: rows.map((row) => Object.fromEntries([...targets.entries()].map(([header, key]) => [key, row[header] ?? '']))),
    problem: null,
  };
}
