import { isBlockedAddress } from '../../common/net/outbound-address';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isDevLikeEnvironment } from '../../config/environment';

/** How long a webhook may take before the step gives up and records the failure. */
export const WEBHOOK_TIMEOUT_MS = 8000;
/** The most of a response body the engine keeps (for the context), so a huge reply cannot bloat it. */
export const WEBHOOK_MAX_RESPONSE_BYTES = 16 * 1024;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

export type WebhookRejection =
  | 'invalid_url'
  | 'scheme_not_allowed'
  | 'port_not_allowed'
  | 'credentials_in_url'
  | 'host_unresolvable'
  | 'private_address'
  | 'method_not_allowed';

export interface WebhookResult {
  ok: boolean;
  status?: number;
  reason?: WebhookRejection | 'timeout' | 'network_error';
  body?: unknown;
}

/**
 * A server-side request forgery guard for the `webhook` action.
 *
 * A workflow author is a tenant user, not an operator: without this an author could point a webhook
 * at `http://169.254.169.254/` (cloud metadata), `localhost:5432`, or any address inside the
 * deployment's network and read the answer back through the instance context. So every target is
 * resolved and refused when any of its addresses is loopback, private, link-local, CGNAT,
 * multicast or reserved — and the request is pinned to the address that was checked, by refusing
 * redirects, so a public name cannot bounce to a private one. Plain `http` is accepted only in
 * development environments.
 */
export async function assertSafeWebhookTarget(raw: string, method: string): Promise<URL | WebhookRejection> {
  if (!ALLOWED_METHODS.has(method)) return 'method_not_allowed';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid_url';
  }
  const dev = isDevLikeEnvironment();
  if (url.protocol !== 'https:' && !(dev && url.protocol === 'http:')) return 'scheme_not_allowed';
  if (url.username || url.password) return 'credentials_in_url';
  if (!ALLOWED_PORTS.has(url.port)) return 'port_not_allowed';

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
    } catch {
      return 'host_unresolvable';
    }
  }
  if (addresses.length === 0) return 'host_unresolvable';
  if (addresses.some(isBlockedAddress)) return 'private_address';
  return url;
}

export async function callWebhook(raw: string, method: string, body: unknown, headers: Record<string, string>): Promise<WebhookResult> {
  const target = await assertSafeWebhookTarget(raw, method);
  if (typeof target === 'string') return { ok: false, reason: target };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method,
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', 'user-agent': 'Virtex-Workflow/1.0', ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const text = await readCapped(response, WEBHOOK_MAX_RESPONSE_BYTES);
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    return { ok: false, reason: (error as Error)?.name === 'AbortError' ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response: Response, max: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    size += value.byteLength;
    if (size > max) {
      chunks.push(value.subarray(0, Math.max(0, value.byteLength - (size - max))));
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export { isBlockedAddress } from '../../common/net/outbound-address';
