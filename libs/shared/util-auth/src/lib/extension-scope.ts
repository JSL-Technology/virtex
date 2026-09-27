/**
 * What an extension's UI may read through the host, decided in ONE place for the browser host and
 * for the API.
 *
 * ## Why this is shared
 *
 * The browser host (`ExtensionHostComponent`) kept this map and its path check to itself, and the
 * check compared a prefix against the path AS WRITTEN while the browser requested the path AS
 * NORMALISED. WHATWG URL parsing treats `%2e%2e`, `.%2e` and `%2e.` as `..`, so an extension
 * granted `api:read:sales` could ask for `/sales/%2e%2e/users` — the prefix check saw `/sales/…`,
 * the browser fetched `/users`, and the capability model protected nothing beyond "whatever the
 * viewing user can read".
 *
 * The rule is now: the path is normalised first and REJECTED if normalisation changed anything,
 * then compared. The API applies the same function to the requests the host tags as coming from an
 * extension, so a future bug in the host is not the only thing standing in the way.
 */

/** Capability → API path prefixes (relative to the API base, no trailing slash). */
export const EXTENSION_API_SCOPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'api:read:sales': ['/invoices', '/sales', '/customers', '/price-lists'],
  'api:read:inventory': ['/inventory', '/products', '/units-of-measure'],
  'api:read:purchasing': ['/suppliers', '/purchasing', '/procurement', '/accounts-payable'],
  'api:read:accounting': ['/chart-of-accounts', '/journal-entries', '/accounting', '/reports'],
  'api:read:projects': ['/projects', '/dimensions'],
  'api:read': ['/currencies', '/taxes', '/units-of-measure', '/localization'],
});

/** The header the host stamps on every request it makes on an extension's behalf. */
export const EXTENSION_REQUEST_HEADER = 'x-virtex-extension';

/** Methods an extension may use: reads only. */
export const EXTENSION_ALLOWED_METHODS: readonly string[] = ['GET', 'HEAD'];

const PARSE_BASE = 'https://extension-scope.invalid';

/**
 * The path an extension asked for, if — and only if — it means exactly what it says.
 *
 * Refused: anything not starting with a single `/`; backslashes and control characters; any
 * percent-encoded dot, slash, backslash or percent (the encodings that change a path's meaning
 * after the check); a fragment; and any path that URL normalisation would rewrite (`.`/`..`
 * segments in any spelling). What is returned is what will be requested.
 */
export function normalizeExtensionApiPath(
  raw: unknown,
): { pathname: string; search: string } | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  if (/%(2e|2f|5c|25)/i.test(raw)) return null;
  if (raw.includes('#')) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, PARSE_BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== PARSE_BASE) return null;

  const questionMark = raw.indexOf('?');
  const writtenPath = questionMark === -1 ? raw : raw.slice(0, questionMark);
  if (parsed.pathname !== writtenPath) return null;

  return { pathname: parsed.pathname, search: parsed.search };
}

/** The prefixes a set of granted capabilities opens. Unknown capabilities open nothing. */
export function extensionApiPrefixes(capabilities: readonly string[]): string[] {
  return capabilities.flatMap((capability) => EXTENSION_API_SCOPES[capability] ?? []);
}

/**
 * Whether an ALREADY NORMALISED pathname falls within the granted capabilities.
 *
 * A prefix matches itself or a sub-path (`/sales` matches `/sales` and `/sales/42`, not
 * `/salesforce`).
 */
export function extensionMayRead(pathname: string, capabilities: readonly string[]): boolean {
  return extensionApiPrefixes(capabilities).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
