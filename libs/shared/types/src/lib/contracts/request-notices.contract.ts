/**
 * What the API tells the reader about a request that succeeded with a caveat — a document
 * converted at the market rate because no official one was on file, say.
 *
 * It travels in a response header rather than in the body, so it works whatever the body is and no
 * response changes shape: a URI-encoded JSON array of notices. Like an error, a notice is a key with
 * its parameters, which the browser renders from its own catalogue in the reader's language;
 * `message` is the same sentence rendered by the server, for a consumer without the catalogue.
 */
export const NOTICES_HEADER = 'Virtex-Notices';

export interface RequestNoticeWire {
  /** Stable, for a client that acts on the notice rather than only showing it. */
  code: string;
  messageKey: string;
  messageParams: Record<string, unknown>;
  message: string;
}

/** The notices in a header value, or none when it is absent or not what the API sends. */
export function parseRequestNotices(header: string | null | undefined): RequestNoticeWire[] {
  if (!header) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(header));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (notice): notice is RequestNoticeWire =>
        typeof notice === 'object' &&
        notice !== null &&
        typeof (notice as RequestNoticeWire).code === 'string' &&
        typeof (notice as RequestNoticeWire).messageKey === 'string' &&
        typeof (notice as RequestNoticeWire).message === 'string' &&
        typeof (notice as RequestNoticeWire).messageParams === 'object' &&
        (notice as RequestNoticeWire).messageParams !== null,
    );
  } catch {
    return [];
  }
}

/** The header value for a list of notices. */
export function serializeRequestNotices(notices: RequestNoticeWire[]): string {
  return encodeURIComponent(JSON.stringify(notices));
}
