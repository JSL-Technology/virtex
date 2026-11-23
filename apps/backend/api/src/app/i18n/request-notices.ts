import { AsyncLocalStorage } from 'node:async_hooks';
import { NOTICES_HEADER } from '@virtex/shared/types';

export { NOTICES_HEADER };

/**
 * Something the reader should know about a request that SUCCEEDED.
 *
 * A refusal has its channel: the exception filter turns `{ messageKey, params }` into the reader's
 * language. A success that came with a caveat had none, so the caveat went to the log: a document
 * converted at the MARKET rate because the company had no OFFICIAL one on file was posted with only
 * a `logger.warn` to say so (audit 2026-11-07, FINB-06) — true in the books, invisible to the person
 * who posted it.
 *
 * A service calls `addNotice` wherever it learns the caveat, without threading anything through its
 * signature; `LocaleInterceptor` collects the request's notices and sends them in the
 * `Virtex-Notices` response header, and the browser shows each in the reader's language. A header
 * rather than a body field, so it works whatever the body is — an entity, a list, a file — and no
 * response DTO changes shape. Outside a request (a job, a script) there is no reader and `addNotice`
 * does nothing; the caller still logs.
 *
 * Like an error, a notice is a KEY with its parameters, never a sentence; `code` is stable for a
 * client that acts on it rather than only showing it.
 */
export interface RequestNotice {
  code: string;
  messageKey: string;
  messageParams?: Record<string, unknown>;
}

/** Enough for any real request; a loop that adds one per line must not grow a header without bound. */
const MAX_NOTICES = 20;

const storage = new AsyncLocalStorage<RequestNotice[]>();

const identityOf = (notice: RequestNotice): string =>
  `${notice.code}|${notice.messageKey}|${JSON.stringify(notice.messageParams ?? {})}`;

/**
 * Tell the reader of the current request. The same notice twice — twenty lines converted at the
 * same fallback rate — is said once.
 *
 * @returns whether there was a request to tell.
 */
export function addNotice(notice: RequestNotice): boolean {
  const notices = storage.getStore();
  if (!notices) return false;
  const identity = identityOf(notice);
  if (notices.length < MAX_NOTICES && !notices.some((existing) => identityOf(existing) === identity)) {
    notices.push(notice);
  }
  return true;
}

/** Run `work` with `notices` as the list `addNotice` writes to, for everything it awaits. */
export function collectNotices<T>(notices: RequestNotice[], work: () => T): T {
  return storage.run(notices, work);
}
