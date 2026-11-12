'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateAppConfig, loadAppConfig, PACKAGED_CONFIG_PATH } = require('./app-config');

const KEY = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
const PIN_A = 'Ge2baYxUMsrA5rkW9gOXxSzJudcNthaxyM4TR/UcTNU=';
const PIN_B = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function release(overrides = {}) {
  return {
    schema: 1,
    portalUrl: 'https://app.virtex.io',
    posUrl: 'https://pos.virtex.io',
    updates: { enabled: true, feedUrl: 'https://updates.virtex.io/desktop', channel: 'latest', trustedKeys: { 'k-2026': KEY } },
    ...overrides,
  };
}

test('a complete release configuration is accepted and normalised', () => {
  const config = validateAppConfig(release(), { isPackaged: true });
  assert.deepEqual(config.allowedOrigins, ['https://app.virtex.io', 'https://pos.virtex.io']);
  assert.equal(config.updates.feedUrl, 'https://updates.virtex.io/desktop/');
  assert.equal(config.updates.trustedKeys.size, 1);
  assert.equal(config.updates.checkIntervalMinutes, 240);
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.updates));
});

test('every problem is reported at once', () => {
  assert.throws(
    () =>
      validateAppConfig(
        release({ portalUrl: 'http://app.virtex.io', updates: { feedUrl: 'http://x', channel: 'nightly', trustedKeys: {} } }),
        { isPackaged: true },
      ),
    (error) =>
      /must use https/.test(error.message) &&
      /feedUrl must be an https URL/.test(error.message) &&
      /channel must be one of/.test(error.message) &&
      /at least one Ed25519/.test(error.message),
  );
});

test('updates can be turned off only explicitly, in the build', () => {
  const config = validateAppConfig(release({ updates: { enabled: false } }), { isPackaged: true });
  assert.equal(config.updates.enabled, false);
  assert.throws(() => validateAppConfig(release({ updates: {} }), { isPackaged: true }), /feedUrl/);
});

test('certificate pins need a backup and the right shape', () => {
  assert.throws(() => validateAppConfig(release({ tls: { pinnedSpkiSha256: [PIN_A] } }), { isPackaged: true }), /backup pin/);
  assert.throws(() => validateAppConfig(release({ tls: { pinnedSpkiSha256: ['nope', PIN_B] } }), { isPackaged: true }), /SPKI/);
  assert.deepEqual(
    validateAppConfig(release({ tls: { pinnedSpkiSha256: [PIN_A, PIN_B] } }), { isPackaged: true }).tls.pinnedSpkiSha256,
    [PIN_A, PIN_B],
  );
});

test('crash reports go only to an https collector', () => {
  assert.throws(() => validateAppConfig(release({ crashReports: { submitUrl: 'http://c' } }), { isPackaged: true }), /submitUrl/);
});

test('a packaged build reads only its built-in file, never the environment', () => {
  const env = { DESKTOP_PORTAL_URL: 'https://evil.example', DESKTOP_POS_URL: 'https://evil.example' };
  const read = (file) => {
    assert.equal(file, PACKAGED_CONFIG_PATH);
    return JSON.stringify(release());
  };
  assert.equal(loadAppConfig({ isPackaged: true, env, readFile: read }).portalUrl, 'https://app.virtex.io');
  assert.throws(
    () => loadAppConfig({ isPackaged: true, env, readFile: () => { throw new Error('ENOENT'); } }),
    /built-in configuration could not be read/,
  );
});

test('development uses the local servers and no updates unless a feed is given', () => {
  const dev = loadAppConfig({ isPackaged: false, env: {} });
  assert.deepEqual(dev.allowedOrigins, ['http://localhost:4200', 'http://localhost:4300']);
  assert.equal(dev.updates.enabled, false);
});
