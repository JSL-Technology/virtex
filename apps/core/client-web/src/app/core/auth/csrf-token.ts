/**
 * Names the CSRF cookie may carry, most-secure first.
 *
 * Production issues `__Host-XSRF-TOKEN`; local plain-HTTP development cannot, because the prefix
 * mandates `Secure` and browsers reject a Secure cookie over HTTP. Both are read so the same build
 * works in either.
 *
 * NOTE: this reads `document.cookie` on the SPA's own origin. The cookie is host-only (it carries
 * no `Domain`, and `__Host-` forbids one), so the API must be served from the SAME origin as the
 * client — a path prefix such as `https://app.example.com/api/v1`, or a reverse proxy that fronts
 * both. A split-subdomain deployment cannot work: the browser would not expose the cookie here,
 * and `SameSite=Lax` session cookies would not be attached to the API calls either. See
 * docs/DEPLOYMENT.md.
 */
const CSRF_COOKIE_NAMES = ['__Host-XSRF-TOKEN', 'XSRF-TOKEN'] as const;

/**
 * The CSRF token this browser holds, or null.
 *
 * Deliberately NOT Angular's `HttpXsrfTokenExtractor`: the extractor only knows the single
 * unprefixed name it was configured with, so against a server that issues `__Host-XSRF-TOKEN` it
 * finds nothing, sends no header, and every state-changing request comes back 403. The
 * interceptor already read the cookie itself for that reason; logout did not, and quietly lost
 * its keepalive path in every deployment as a result. One reader, used by everything.
 */
export function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const name of CSRF_COOKIE_NAMES) {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}=([^;]*)`),
    );
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}
