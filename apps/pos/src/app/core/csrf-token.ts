/**
 * The CSRF token this browser holds, or null. Ported verbatim from the web client so the POS app
 * speaks the same double-submit protocol: production issues `__Host-XSRF-TOKEN`, local plain-HTTP
 * dev falls back to `XSRF-TOKEN`.
 */
const CSRF_COOKIE_NAMES = ['__Host-XSRF-TOKEN', 'XSRF-TOKEN'] as const;

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
