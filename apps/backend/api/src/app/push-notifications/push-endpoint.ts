/**
 * Which URLs a push subscription may name.
 *
 * The server POSTs every notification to the subscription's `endpoint` (that is the Web Push
 * protocol). An endpoint taken unchecked from a request body is therefore a server-side request
 * forgery primitive: name `http://169.254.169.254/…` or an internal service and the API calls it,
 * with a body, on every notification (audit 2026-11-07, PLT-NOT-01).
 *
 * A genuine endpoint is minted by the browser's push service, and there are few of them. Only those
 * hosts, over HTTPS, on the default port, without credentials, are accepted — at subscription AND
 * again before every send, so a row written before this rule cannot be used either.
 */
const PUSH_SERVICE_HOSTS: ReadonlyArray<string | RegExp> = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium), Opera, Samsung Internet
  'updates.push.services.mozilla.com', // Firefox
  'push.services.mozilla.com',
  'web.push.apple.com', // Safari 16+, iOS 16.4+
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/, // legacy Edge / Windows WNS
];

export const MAX_PUSH_ENDPOINT_LENGTH = 2048;

export function isTrustedPushEndpoint(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > MAX_PUSH_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => (typeof allowed === 'string' ? host === allowed : allowed.test(host)));
}
