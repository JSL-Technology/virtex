#!/usr/bin/env node
/**
 * Write the desktop shell's built-in configuration (apps/desktop/config/app-config.json).
 *
 * The release workflow runs this before electron-builder. The file is validated with the SAME
 * function the shell runs at startup (apps/desktop/src/app-config.js, in packaged mode), so a
 * configuration the shell would refuse to start with fails the build here, not on a customer's
 * machine.
 *
 * Inputs (environment):
 *   DESKTOP_PORTAL_URL, DESKTOP_POS_URL       https origins the window may show            (required)
 *   DESKTOP_UPDATES_ENABLED                   "false" only for a build updated by other means
 *   DESKTOP_UPDATE_FEED_URL                   https base URL of the update feed            (required if enabled)
 *   DESKTOP_UPDATE_CHANNEL                    latest | beta                                (default latest)
 *   DESKTOP_UPDATE_TRUSTED_KEYS               JSON {keyId: "<Ed25519 public key PEM>"}     (required if enabled)
 *   DESKTOP_UPDATE_CHECK_INTERVAL_MINUTES     default 240
 *   DESKTOP_TLS_PINS                          comma-separated base64 SPKI SHA-256 pins (optional, ≥2)
 *   DESKTOP_CRASH_SUBMIT_URL                  https crash collector (optional)
 *   GITHUB_SHA                                recorded as the build's commit
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { validateAppConfig, CONFIG_SCHEMA } = require(join(ROOT, 'apps/desktop/src/app-config.js'));
const OUT = join(ROOT, 'apps/desktop/config/app-config.json');

const env = process.env;
const updatesEnabled = env.DESKTOP_UPDATES_ENABLED !== 'false';

let trustedKeys = {};
try {
  trustedKeys = JSON.parse(env.DESKTOP_UPDATE_TRUSTED_KEYS || '{}');
} catch {
  console.error('✗ DESKTOP_UPDATE_TRUSTED_KEYS is not valid JSON ({"keyId": "-----BEGIN PUBLIC KEY-----…"}).');
  process.exit(1);
}

const config = {
  schema: CONFIG_SCHEMA,
  portalUrl: env.DESKTOP_PORTAL_URL,
  posUrl: env.DESKTOP_POS_URL,
  updates: updatesEnabled
    ? {
        enabled: true,
        feedUrl: env.DESKTOP_UPDATE_FEED_URL,
        channel: env.DESKTOP_UPDATE_CHANNEL || 'latest',
        checkIntervalMinutes: Number(env.DESKTOP_UPDATE_CHECK_INTERVAL_MINUTES || 240),
        trustedKeys,
      }
    : { enabled: false },
  tls: { pinnedSpkiSha256: (env.DESKTOP_TLS_PINS || '').split(',').map((pin) => pin.trim()).filter(Boolean) },
  crashReports: { submitUrl: env.DESKTOP_CRASH_SUBMIT_URL || null },
  build: { commit: env.GITHUB_SHA || 'local', builtAt: new Date().toISOString() },
};

try {
  validateAppConfig(config, { isPackaged: true });
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(config, null, 2)}\n`);
console.log(`✓ ${relative(ROOT, OUT)} (channel ${config.updates.channel ?? 'none'}, ${Object.keys(trustedKeys).length} trusted key(s))`);
