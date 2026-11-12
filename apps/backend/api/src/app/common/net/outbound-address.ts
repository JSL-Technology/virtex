import { isIP } from 'node:net';
import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { Agent as HttpsAgent } from 'node:https';

/**
 * Outbound requests to an address a tenant chose, without reaching inside the deployment.
 *
 * Moved here from the workflow engine's webhook guard so every feature that calls a
 * tenant-configured URL — a workflow webhook, a fiscal authority or PAC endpoint — refuses the same
 * addresses (loopback, private, link-local and cloud metadata, CGNAT, multicast, reserved) with one
 * implementation instead of one per feature.
 */

/** True for any address a tenant must never reach from the server. */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedV4(address);
  if (version === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms carry a v4 address: check that one.
    const mapped = /^(?:0*:)*(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isBlockedV4(mapped[1]);
    if (lower === '::' || lower === '::1') return true;
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (lower.startsWith('64:ff9b:')) return true; // NAT64
    if (lower.startsWith('2001:db8') || lower.startsWith('2001:0db8')) return true; // documentation
    return false;
  }
  return true;
}

function isBlockedV4(address: string): boolean {
  const [a, b, c] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF + documentation
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // documentation
  if (a === 203 && b === 0 && c === 113) return true; // documentation
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}


/**
 * A DNS lookup that refuses blocked addresses at CONNECT time.
 *
 * Checking the name once when a URL is saved is not enough: the name can be re-pointed afterwards,
 * or answer differently on the next lookup (DNS rebinding). Using this as the agent's `lookup`
 * means the address actually connected to is the address that was checked.
 */
export function guardedLookup(
  hostname: string,
  options: object,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...(options as object), all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const list = addresses as LookupAddress[];
    const blocked = list.find((entry) => isBlockedAddress(entry.address));
    if (!list.length || blocked) {
      const refusal = Object.assign(new Error(`Refused to connect to ${hostname}: not a public address`), { code: 'EADDRNOTPUBLIC' });
      return callback(refusal, []);
    }
    const wantsAll = Boolean((options as { all?: boolean }).all);
    return wantsAll ? callback(null, list) : callback(null, list[0].address, list[0].family);
  });
}

/** An HTTPS agent whose every connection goes through {@link guardedLookup}. */
export function publicOnlyHttpsAgent(): HttpsAgent {
  return new HttpsAgent({ lookup: guardedLookup as never, keepAlive: true, maxSockets: 16 });
}

export type EndpointRejection = 'invalid_url' | 'scheme_not_allowed' | 'credentials_in_url' | 'port_not_allowed' | 'too_long' | 'host_unresolvable' | 'private_address';

/**
 * A URL the server may POST a tenant's documents to: HTTPS, on 443 or 8443, no credentials in the
 * URL, at most 512 characters, and resolving only to public addresses. `null` when acceptable.
 */
export async function checkPublicHttpsEndpoint(raw: string): Promise<EndpointRejection | null> {
  if (raw.length > 512) return 'too_long';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid_url';
  }
  if (url.protocol !== 'https:') return 'scheme_not_allowed';
  if (url.username || url.password) return 'credentials_in_url';
  if (!['', '443', '8443'].includes(url.port)) return 'port_not_allowed';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return isBlockedAddress(host) ? 'private_address' : null;
  const addresses = await new Promise<LookupAddress[] | null>((resolve) =>
    dnsLookup(host, { all: true, verbatim: true }, (error, list) => resolve(error ? null : (list as LookupAddress[]))),
  );
  if (!addresses || addresses.length === 0) return 'host_unresolvable';
  return addresses.some((entry) => isBlockedAddress(entry.address)) ? 'private_address' : null;
}
