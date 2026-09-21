import { isDevLikeEnvironment } from '../auth.config';

/**
 * The one rule for which cookie carries an access token.
 *
 * There were two. `JwtStrategy` accepted `__Host-access_token` always and the bare
 * `access_token` only in development, where browsers reject the `Secure` attribute that the
 * `__Host-` prefix mandates. `EventsGateway` accepted both names in every environment, with its
 * own inline `cookieHeader.split(';')` parser.
 *
 * Two contracts for one credential is how they drift. The signature check downstream meant the
 * looser one was not directly exploitable, but "not exploitable today" is the property that
 * changes when somebody edits one of the two and not the other.
 */

/** The prefixed name, which every deployment issues. */
export const ACCESS_TOKEN_COOKIE = '__Host-access_token';

/**
 * The unprefixed name. It exists only for local plain-HTTP development, because `__Host-` forces
 * `Secure` and a browser will not store a `Secure` cookie over `http://`.
 */
export const ACCESS_TOKEN_COOKIE_DEV = 'access_token';

/** Names accepted in the current environment, most-secure first. */
export function acceptedAccessTokenCookieNames(): string[] {
  return isDevLikeEnvironment()
    ? [ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_COOKIE_DEV]
    : [ACCESS_TOKEN_COOKIE];
}

/** Pick the access token out of an already-parsed cookie bag (the HTTP path). */
export function selectAccessToken(
  cookies: Record<string, string | undefined> | undefined,
): string | null {
  if (!cookies) return null;
  for (const name of acceptedAccessTokenCookieNames()) {
    const value = cookies[name];
    if (value) return value;
  }
  return null;
}

/**
 * Pick the access token out of a raw `Cookie` header (the WebSocket handshake, which has no
 * cookie parser in front of it).
 *
 * Only the first `=` is treated as the separator: a JWT contains none, but a cookie value in
 * general may, and splitting on every `=` truncates such a value into something that then fails
 * signature verification for a reason that looks nothing like the cause.
 */
export function readAccessTokenCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  const jar: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator);
    // Only the names we care about, and only the first occurrence of each: a duplicate cookie
    // injected by a sibling subdomain must not shadow the real one.
    if (!(name in jar)) jar[name] = decodeURIComponent(trimmed.slice(separator + 1));
  }

  return selectAccessToken(jar);
}
