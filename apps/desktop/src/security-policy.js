// The desktop shell's trust decisions, as pure functions.
//
// Kept apart from main.js so they can be tested without Electron (`node --test`), and so the whole
// policy can be read in one place: which origins the window may show, which links may leave for
// the operating system, which renderer may talk to the main process, and which configurations a
// packaged build refuses to run with.
'use strict';

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

module.exports = {
  EXTERNAL_SCHEMES,
  GRANTABLE_PERMISSIONS,
  originOf,
  mayOpenExternally,
  resolveTargets,
  isTrustedUrl,
  isTrustedSender,
  mayGrantPermission,
};
