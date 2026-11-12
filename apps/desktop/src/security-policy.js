// The desktop shell's trust decisions, as pure functions.
//
// Kept apart from main.js so they can be tested without Electron (`node --test`), and so the whole
// policy can be read in one place: which origins the window may show, which links may leave for
// the operating system, which renderer may talk to the main process, and which configurations a
// packaged build refuses to run with.
'use strict';

const crypto = require('node:crypto');

/**
 * Schemes the operating system may be asked to open.
 *
 * `shell.openExternal` hands the URL to whatever the OS has registered for its scheme: `file:`
 * opens (and, for some types, runs) local files, `smb:` mounts shares, and every installed
 * application can register its own scheme with its own argument parsing. A link in a page, or in
 * a record a user typed, must not be able to reach any of that. The web client links out to
 * websites and to mail; nothing else.
 */
const EXTERNAL_SCHEMES = new Set(['https:', 'mailto:']);

/** Permissions a trusted page may be granted. Everything else — camera, geolocation, … — is denied. */
const GRANTABLE_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen', 'notifications']);

function originOf(url) {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/** Whether a URL may be handed to the operating system. */
function mayOpenExternally(url) {
  try {
    const parsed = new URL(url);
    if (!EXTERNAL_SCHEMES.has(parsed.protocol)) return false;
    // Credentials in a link are a phishing device (`https://bank.com@evil.example`), never needed.
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve and validate the origins the shell loads.
 *
 * A packaged build is what customers install. Loading the portal or the till over plain HTTP
 * there would put the session cookies and every screen of the ERP on the wire, and the localhost
 * defaults exist only for development — a packaged build that silently fell back to them would
 * show whatever happens to listen on that port. So a packaged build requires both URLs,
 * explicitly, over HTTPS, and refuses to start otherwise.
 *
 * @returns {{ portalUrl: string, posUrl: string, allowedOrigins: string[] }}
 */
function resolveTargets(env, isPackaged) {
  const portalUrl = env.DESKTOP_PORTAL_URL || (isPackaged ? '' : 'http://localhost:4200');
  const posUrl = env.DESKTOP_POS_URL || (isPackaged ? '' : 'http://localhost:4300');

  const problems = [];
  for (const [name, value] of [
    ['DESKTOP_PORTAL_URL', portalUrl],
    ['DESKTOP_POS_URL', posUrl],
  ]) {
    let parsed = null;
    try {
      parsed = new URL(value);
    } catch {
      problems.push(`${name} is missing or not a URL`);
      continue;
    }
    if (isPackaged && parsed.protocol !== 'https:') {
      problems.push(`${name} must use https in a packaged build (got ${parsed.protocol})`);
    } else if (!['https:', 'http:'].includes(parsed.protocol)) {
      problems.push(`${name} must be an http(s) URL (got ${parsed.protocol})`);
    }
  }
  if (problems.length) {
    throw new Error(`Refusing to start: ${problems.join('; ')}.`);
  }

  return {
    portalUrl,
    posUrl,
    allowedOrigins: [originOf(portalUrl), originOf(posUrl)].filter(Boolean),
  };
}

/** Whether the window may show this URL itself (rather than hand it to the OS or drop it). */
function isTrustedUrl(url, allowedOrigins) {
  const origin = originOf(url);
  return origin !== null && allowedOrigins.includes(origin);
}

/**
 * Whether an IPC message comes from a trusted page.
 *
 * The preload is attached to every frame the window loads. Were a trusted page ever to embed a
 * third-party frame, or the window to be navigated elsewhere by a bug in the guard, that content
 * would reach the same IPC channels. Each handler therefore checks the frame that sent the message.
 */
function isTrustedSender(senderUrl, allowedOrigins) {
  return isTrustedUrl(senderUrl, allowedOrigins);
}

function mayGrantPermission(permission, requestingUrl, allowedOrigins) {
  return GRANTABLE_PERMISSIONS.has(permission) && isTrustedUrl(requestingUrl, allowedOrigins);
}


/**
 * A Content-Security-Policy the shell adds to every trusted page, on top of the server's own.
 *
 * Browsers enforce every CSP a response carries and a resource must satisfy all of them, so an extra
 * policy can only tighten, never loosen: it cannot break a directive the server set, and it keeps
 * these guarantees even if a deployment is served without the headers `serve.json` declares.
 * The directives are the ones an Angular single-page application never needs relaxed:
 *
 *   object-src 'none'       no plugins — the oldest route to code execution in a page
 *   base-uri 'self'         an injected <base> cannot redirect every relative script URL
 *   frame-ancestors 'none'  the portal cannot be framed (clickjacking) by anything
 *
 * `script-src` is deliberately left to the server: tightening it here without the server's nonces
 * would break the application, and a half-applied script policy protects nothing.
 */
const BASELINE_CSP = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

/**
 * Add the baseline policy to a response's headers, without disturbing the server's own.
 *
 * Header names arrive in whatever case the server used; a second header is added under its own key
 * so both policies are enforced.
 */
function withBaselineCsp(responseHeaders) {
  const headers = { ...(responseHeaders || {}) };
  const existing = Object.keys(headers).find((name) => name.toLowerCase() === 'content-security-policy');
  const values = existing ? [].concat(headers[existing]) : [];
  if (existing) delete headers[existing];
  headers['Content-Security-Policy'] = [...values, BASELINE_CSP];
  return headers;
}

/** base64 SHA-256 of a certificate's SubjectPublicKeyInfo — the value an HPKP-style pin holds. */
function spkiSha256(certificatePem) {
  const certificate = new crypto.X509Certificate(certificatePem);
  const spki = certificate.publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(spki).digest('base64');
}

/**
 * Whether a certificate chain satisfies the configured pins.
 *
 * Pinning is optional (no pins → every chain the operating system trusts passes). With pins, at
 * least one certificate in the presented chain — the leaf, or an intermediate the operator chose to
 * pin so certificates can be renewed without a client release — must carry a pinned key. A chain
 * that cannot be parsed fails closed.
 *
 * @param {string[]} chainPems  leaf first
 * @param {readonly string[]} pins
 */
function chainMatchesPins(chainPems, pins) {
  if (!pins || pins.length === 0) return true;
  try {
    return chainPems.some((pem) => pins.includes(spkiSha256(pem)));
  } catch {
    return false;
  }
}

/** Hosts the pins apply to: the configured origins, and nothing else the shell might contact. */
function pinnedHosts(allowedOrigins) {
  return new Set(
    allowedOrigins
      .map((origin) => {
        try {
          return new URL(origin).hostname;
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  );
}

module.exports = {
  EXTERNAL_SCHEMES,
  GRANTABLE_PERMISSIONS,
  originOf,
  mayOpenExternally,
  resolveTargets,
  isTrustedUrl,
  isTrustedSender,
  mayGrantPermission,
  BASELINE_CSP,
  withBaselineCsp,
  spkiSha256,
  chainMatchesPins,
  pinnedHosts,
};
