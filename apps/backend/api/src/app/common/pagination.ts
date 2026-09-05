/**
 * One shape for every paged list, and one place the bounds are decided.
 *
 * ## Why a shared helper rather than a clamp per service
 *
 * The finance list routes returned everything: `GET /journal-entries` handed back every entry a
 * tenant had ever posted, with its lines, its journal and its ledger eagerly attached. For an
 * established tenant that is the entire general ledger in one response — enough to exhaust the
 * process's memory before a byte reaches the client, and it happens on an ordinary screen load.
 *
 * Each service clamping its own numbers produces a different default per route and a different
 * envelope per route, which the client then has to special-case. The bound belongs in one place,
 * with a ceiling no caller can raise: `pageSize=100000` is not a request to be honoured.
 */

/** The window a caller asked for, after clamping. */
export interface Paging {
  page: number;
  pageSize: number;
  /** Rows to skip — what TypeORM's `skip`/`offset` wants. */
  skip: number;
  /** Rows to take. */
  take: number;
}

/** A page of rows plus what a client needs to ask for the next one. */
export interface Page<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

/**
 * A validated window from whatever the caller sent.
 *
 * Non-numeric, negative, zero and fractional values all resolve to something usable rather than to
 * `LIMIT NaN`, which PostgreSQL rejects with a syntax error the user cannot act on.
 */
export function resolvePaging(
  page?: number | string,
  pageSize?: number | string,
  defaultPageSize = DEFAULT_PAGE_SIZE,
): Paging {
  const requestedPage = Math.floor(Number(page));
  const requestedSize = Math.floor(Number(pageSize));

  const resolvedPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const resolvedSize =
    Number.isFinite(requestedSize) && requestedSize > 0
      ? Math.min(requestedSize, MAX_PAGE_SIZE)
      : defaultPageSize;

  return {
    page: resolvedPage,
    pageSize: resolvedSize,
    skip: (resolvedPage - 1) * resolvedSize,
    take: resolvedSize,
  };
}

/** Wrap a `findAndCount` result in the envelope. */
export function toPage<T>(rows: T[], total: number, paging: Paging): Page<T> {
  return {
    rows,
    page: paging.page,
    pageSize: paging.pageSize,
    total,
    hasMore: paging.page * paging.pageSize < total,
  };
}
