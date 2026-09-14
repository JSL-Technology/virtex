/**
 * Which catalogue key an HTTP failure is shown with.
 *
 * ## The contract
 *
 * The API answers a failure with names, never prose:
 *
 *     { statusCode, code, messageKey, params, fieldErrors?, timestamp, path }
 *
 * `code` is a stable machine identifier a caller may branch on — a two-factor challenge and a
 * blocked account are both 401 and lead to different screens. `messageKey` and `params` name the
 * catalogue entry for the wording.
 *
 * ## Why the order is this order
 *
 *  1. `errors.<code>` — wording chosen deliberately for a code the product handles specially.
 *  2. `messageKey` — the specific domain message the server named.
 *  3. `errors.http_<status>` — the generic sentence for the status class.
 *  4. `errors.unexpected`.
 *
 * A raw string from the server is never rendered, and nothing from a 5xx is: those messages are
 * written for an operator, and a stack fragment or a constraint name reaching the browser is an
 * information-disclosure defect (OWASP ASVS V7.4.1, CWE-209). The till used to render
 * `err.error.message` directly, which is how a cashier could be shown a database error.
 *
 * Shared rather than written twice because the order IS the contract: two applications resolving it
 * differently is the same class of defect as two catalogues wording one key differently.
 */
import { composeKey } from '@virteex/shared/types';

/** The body of an error response, as far as this cares. */
export interface ApiErrorBody {
  code?: unknown;
  error?: unknown;
  messageKey?: unknown;
  params?: unknown;
  fieldErrors?: unknown;
}

export interface ApiErrorLike {
  status?: number;
  error?: unknown;
}

/** A stable machine code, when the response carries one. */
export function errorCodeOf(response: ApiErrorLike | null | undefined): string | null {
  const body = response?.error as ApiErrorBody | null | undefined;
  for (const candidate of [body?.code, body?.error]) {
    // A default NestJS filter puts the reason phrase ("Bad Request") in `error`. That is a status
    // name, not a domain code, and requiring the screaming-snake shape keeps it out.
    if (typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{2,}$/.test(candidate)) return candidate;
  }
  return null;
}

/** The interpolation parameters the server sent with the message key. */
export function errorParamsOf(response: ApiErrorLike | null | undefined): Record<string, unknown> {
  const params = (response?.error as ApiErrorBody | null | undefined)?.params;
  return params !== null && typeof params === 'object' && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

/**
 * The key to render, given a way to ask whether the catalogue has one.
 *
 * `has` is passed in rather than injected so this stays a pure function that either runtime can
 * call — the web client asks `TranslateService`, the till asks its own, and a test asks a set.
 */
export function resolveErrorKey(
  response: ApiErrorLike | null | undefined,
  has: (key: string) => boolean,
): string {
  // A browser-level failure: DNS, TLS, or the device being offline. There is no server answer to
  // read, and the browser's own message is neither translated nor meaningful to a reader.
  if (response?.error instanceof ProgressEvent || response?.status === 0) return 'errors.network';

  const status = response?.status ?? 0;
  const code = errorCodeOf(response);
  if (code) {
    const byCode = composeKey('errors', code);
    if (has(byCode)) return byCode;
  }

  const body = response?.error as ApiErrorBody | null | undefined;
  if (status < 500 && typeof body?.messageKey === 'string' && body.messageKey.trim()) {
    if (has(body.messageKey)) return body.messageKey;
  }

  const byStatus = `errors.http_${status}`;
  if (has(byStatus)) return byStatus;

  return 'errors.unexpected';
}
