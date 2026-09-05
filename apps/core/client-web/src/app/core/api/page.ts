/**
 * One page of a list, and what a caller needs to ask for the next one.
 *
 * Mirrors the server's `common/pagination.ts` envelope exactly. It lived inside
 * `journal-entries.service.ts`, which meant the second paged endpoint had to either import from
 * that service — coupling treasury to the general ledger for a shape neither owns — or declare its
 * own copy that would drift.
 */
export interface Page<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}
