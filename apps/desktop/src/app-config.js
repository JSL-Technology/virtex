// The shell's configuration: where it points, how it updates, and what it trusts.
//
// ## Built in, not read from the environment
//
// A packaged build used to read its two URLs from DESKTOP_PORTAL_URL and DESKTOP_POS_URL and refuse
// to start without them. That is correct for a developer and impossible for a customer: nobody sets
// environment variables before double-clicking an installed application. It also made the trust
// decision — which origin this window will hand its session cookies to — something anyone able to
// set a user's environment could change.
//
// A packaged build now reads `config/app-config.json`, which `tools/desktop/write-app-config.mjs`
// writes at build time from the release workflow's configuration. The file lives inside the asar
// archive, so the EnableEmbeddedAsarIntegrityValidation and OnlyLoadAppFromAsar fuses, and the
// platform code signature over the whole bundle, make it as tamper-evident as the code itself. The
// environment is read only in development.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const policy = require('./security-policy');
const { loadTrustedKeys } = require('./release-verification');

const CONFIG_SCHEMA = 1;
/** Channels electron-updater reads: `latest` is the stable channel's historical name. */
const CHANNELS = new Set(['latest', 'beta']);
const SPKI_PIN = /^[A-Za-z0-9+/]{43}=$/; // base64 SHA-256

/** Where a packaged build finds its configuration. */
const PACKAGED_CONFIG_PATH = path.join(__dirname, '..', 'config', 'app-config.json');

function httpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Validate and normalise a configuration object.
 *
 * Every problem is collected and reported together: a release build that fails here fails in CI
 * (`write-app-config.mjs` runs this same function), so the message should say everything at once.
 *
 * @param {any} raw
 * @param {{ isPackaged: boolean }} options
 */
function validateAppConfig(raw, { isPackaged }) {
  const problems = [];
  const config = raw && typeof raw === 'object' ? raw : {};

  if (config.schema !== CONFIG_SCHEMA) problems.push(`schema must be ${CONFIG_SCHEMA}`);

  let targets = null;
  try {
    targets = policy.resolveTargets(
      { DESKTOP_PORTAL_URL: config.portalUrl, DESKTOP_POS_URL: config.posUrl },
      isPackaged,
    );
  } catch (error) {
    problems.push(error.message.replace(/^Refusing to start: /, '').replace(/\.$/, ''));
  }

  const updates = config.updates && typeof config.updates === 'object' ? config.updates : {};
  const updatesEnabled = updates.enabled !== false;
  let trustedKeys = new Map();
  if (updatesEnabled) {
    if (!httpsUrl(updates.feedUrl)) problems.push('updates.feedUrl must be an https URL');
    if (!CHANNELS.has(updates.channel)) problems.push(`updates.channel must be one of ${[...CHANNELS].join(', ')}`);
    try {
      trustedKeys = loadTrustedKeys(updates.trustedKeys);
    } catch (error) {
      problems.push(`updates.trustedKeys: ${error.message}`);
    }
    if (!trustedKeys.size) problems.push('updates.trustedKeys must name at least one Ed25519 public key');
    const interval = updates.checkIntervalMinutes ?? 240;
    if (!Number.isInteger(interval) || interval < 15 || interval > 1440) {
      problems.push('updates.checkIntervalMinutes must be an integer between 15 and 1440');
    }
  }

  // Optional public-key pinning for the configured origins. Two pins at least — the live key and a
  // backup that is not yet deployed — or a certificate renewal locks every installed client out.
  const pins = config.tls?.pinnedSpkiSha256 ?? [];
  if (!Array.isArray(pins) || pins.some((pin) => !SPKI_PIN.test(pin))) {
    problems.push('tls.pinnedSpkiSha256 must be a list of base64 SHA-256 SPKI hashes');
  } else if (pins.length === 1) {
    problems.push('tls.pinnedSpkiSha256 needs a backup pin (at least two) to survive a key rotation');
  }

  const crashSubmitUrl = config.crashReports?.submitUrl ?? null;
  if (crashSubmitUrl !== null && !httpsUrl(crashSubmitUrl)) {
    problems.push('crashReports.submitUrl must be an https URL');
  }

  if (problems.length) throw new Error(`Invalid desktop configuration: ${problems.join('; ')}.`);

  return Object.freeze({
    portalUrl: targets.portalUrl,
    posUrl: targets.posUrl,
    allowedOrigins: targets.allowedOrigins,
    updates: Object.freeze({
      enabled: updatesEnabled,
      feedUrl: updatesEnabled ? httpsUrl(updates.feedUrl).toString().replace(/\/?$/, '/') : null,
      channel: updatesEnabled ? updates.channel : null,
      checkIntervalMinutes: updates.checkIntervalMinutes ?? 240,
      trustedKeys,
    }),
    tls: Object.freeze({ pinnedSpkiSha256: Object.freeze([...pins]) }),
    crashReports: Object.freeze({ submitUrl: crashSubmitUrl }),
    build: Object.freeze({
      commit: typeof config.build?.commit === 'string' ? config.build.commit : 'development',
      builtAt: typeof config.build?.builtAt === 'string' ? config.build.builtAt : null,
    }),
  });
}

/** The configuration a development run uses: the local servers, and no updates unless asked. */
function developmentConfig(env) {
  const feedUrl = env.DESKTOP_UPDATE_FEED_URL;
  return {
    schema: CONFIG_SCHEMA,
    portalUrl: env.DESKTOP_PORTAL_URL || 'http://localhost:4200',
    posUrl: env.DESKTOP_POS_URL || 'http://localhost:4300',
    updates: feedUrl
      ? {
          enabled: true,
          feedUrl,
          channel: env.DESKTOP_UPDATE_CHANNEL || 'latest',
          trustedKeys: JSON.parse(env.DESKTOP_UPDATE_TRUSTED_KEYS || '{}'),
        }
      : { enabled: false },
  };
}

/**
 * Load the configuration this process runs with.
 *
 * Packaged: only the built-in file, never the environment. Development: the environment and the
 * local defaults.
 */
function loadAppConfig({ isPackaged, env = process.env, readFile = fs.readFileSync } = {}) {
  if (!isPackaged) return validateAppConfig(developmentConfig(env), { isPackaged: false });
  let raw;
  try {
    raw = JSON.parse(readFile(PACKAGED_CONFIG_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid desktop configuration: the built-in configuration could not be read (${error.message}).`);
  }
  return validateAppConfig(raw, { isPackaged: true });
}

module.exports = { CONFIG_SCHEMA, CHANNELS, PACKAGED_CONFIG_PATH, validateAppConfig, developmentConfig, loadAppConfig };
