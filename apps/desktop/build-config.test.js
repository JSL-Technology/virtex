'use strict';
// Invariants of how the desktop shell is BUILT: what makes the shipped binary safe is configuration,
// and configuration regresses silently unless something fails when it changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareVersions } = require('./src/release-verification');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG = path.join(__dirname, 'electron-builder.config.cjs');
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'security-baseline.json'), 'utf8'));

function loadBuilderConfig(env = {}) {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith('VIRTEX_DESKTOP') || key.startsWith('AZURE_') || key.startsWith('APPLE_') || key.startsWith('CSC_') || key === 'WINDOWS_PUBLISHER_NAME') delete process.env[key];
  Object.assign(process.env, env);
  delete require.cache[require.resolve(CONFIG)];
  try {
    return require(CONFIG);
  } finally {
    process.env = saved;
    delete require.cache[require.resolve(CONFIG)];
  }
}

test('every Electron fuse that turns the app into a scriptable Node runtime is off', () => {
  const { electronFuses } = loadBuilderConfig();
  assert.deepEqual(electronFuses, {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  });
});

test('the bundle is the app and nothing else, under asar integrity', () => {
  const config = loadBuilderConfig();
  assert.equal(config.asar, true);
  assert.deepEqual(config.asarUnpack, []);
  assert.equal(config.directories.app, 'apps/desktop');
  assert.ok(config.files.includes('!src/**/*.test.js'));
  // The app's manifest declares exactly one runtime dependency, pinned.
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.dependencies), ['electron-updater']);
  assert.match(manifest.dependencies['electron-updater'], /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.main, 'src/main.js');
  assert.ok(fs.existsSync(path.join(__dirname, 'package-lock.json')), 'the installer runtime has its own lockfile');
});

test('a development build publishes nothing and does not pretend to be signed', () => {
  const config = loadBuilderConfig();
  assert.equal(config.publish, null);
  assert.equal(config.forceCodeSigning, false);
  assert.equal(config.mac.notarize, false);
  assert.equal(config.win.azureSignOptions, undefined);
});

test('a release build refuses to exist without its built-in configuration', () => {
  assert.ok(!fs.existsSync(path.join(__dirname, 'config', 'app-config.json')), 'stale generated config in the tree');
  assert.throws(() => loadBuilderConfig({ VIRTEX_DESKTOP_RELEASE: 'true' }), /write-app-config/);
});

test('a release build refuses to exist without every signing input of its platform', () => {
  const { missingReleaseInputs } = require('./build/release-inputs.cjs');
  const base = { VIRTEX_DESKTOP_RELEASE: 'true' };
  assert.deepEqual(missingReleaseInputs('darwin', base), ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']);
  assert.ok(missingReleaseInputs('win32', base).includes('WINDOWS_PUBLISHER_NAME'));
  assert.ok(missingReleaseInputs('win32', base).includes('AZURE_CLIENT_SECRET'));
  assert.deepEqual(missingReleaseInputs('linux', base), []);
  assert.deepEqual(missingReleaseInputs('linux', {}), ['VIRTEX_DESKTOP_RELEASE']);
});

test('a release build is signed, notarised, timestamped and publishes to an https feed', () => {
  const configFile = path.join(__dirname, 'config', 'app-config.json');
  const existed = fs.existsSync(configFile);
  const previous = existed ? fs.readFileSync(configFile) : null;
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(
    configFile,
    JSON.stringify({ schema: 1, updates: { enabled: true, feedUrl: 'https://updates.virtex.io/desktop/', channel: 'latest' } }),
  );
  try {
    const env = {
      VIRTEX_DESKTOP_RELEASE: 'true',
      CSC_LINK: 'x', CSC_KEY_PASSWORD: 'x', APPLE_API_KEY: 'x', APPLE_API_KEY_ID: 'x', APPLE_API_ISSUER: 'x',
      AZURE_TENANT_ID: 'x', AZURE_CLIENT_ID: 'x', AZURE_CLIENT_SECRET: 'x', AZURE_TRUSTED_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net',
      AZURE_TRUSTED_SIGNING_ACCOUNT: 'virtex', AZURE_TRUSTED_SIGNING_PROFILE: 'virtex-public', WINDOWS_PUBLISHER_NAME: 'JSL Technology SRL',
    };
    const config = loadBuilderConfig(env);
    assert.equal(config.forceCodeSigning, true);
    assert.equal(config.mac.notarize, true);
    assert.equal(config.mac.hardenedRuntime, true);
    assert.equal(config.dmg.sign, true);
    assert.deepEqual(config.publish, [{ provider: 'generic', url: 'https://updates.virtex.io/desktop/', channel: 'latest' }]);
    assert.equal(config.win.azureSignOptions.publisherName, 'JSL Technology SRL');
    assert.equal(config.win.azureSignOptions.fileDigest, 'SHA256');
    assert.equal(config.win.azureSignOptions.timestampDigest, 'SHA256');
    assert.match(config.win.azureSignOptions.timestampRfc3161, /^http:\/\/timestamp\.acs\.microsoft\.com$/);
    assert.equal(config.win.signtoolOptions, undefined, 'signing goes through the HSM-backed Azure service, never a local certificate');
    assert.equal(config.win.verifyUpdateCodeSignature, true);
    // macOS updates need the zip target; Squirrel.Mac cannot install from a dmg.
    assert.ok(config.mac.target.some((entry) => entry.target === 'zip'));
  } finally {
    if (existed) fs.writeFileSync(configFile, previous);
    else fs.rmSync(path.join(__dirname, 'config'), { recursive: true, force: true });
  }
});

test('macOS entitlements stay minimal', () => {
  const plist = fs.readFileSync(path.join(__dirname, 'build', 'entitlements.mac.plist'), 'utf8');
  const granted = [...plist.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map((match) => match[1]);
  assert.deepEqual(granted, ['com.apple.security.cs.allow-jit']);
});

test('Electron is pinned exactly and at or above the security baseline', () => {
  const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = root.devDependencies.electron;
  assert.match(declared, /^\d+\.\d+\.\d+$/, 'electron must be pinned to an exact version');
  assert.ok(compareVersions(declared, baseline.minimumElectron) >= 0, `electron ${declared} < baseline ${baseline.minimumElectron}`);
  const installed = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  assert.equal(installed, declared, 'node_modules must match the pinned version (npm ci)');
  assert.match(root.devDependencies['electron-builder'], /^\d+\.\d+\.\d+$/);
});

test('the updater and the packager agree on the update manifest format', () => {
  // electron-builder writes latest.yml with builder-util-runtime; electron-updater reads it with
  // builder-util-runtime. Two different versions is how a manifest field ends up ignored.
  const lock = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).packages;
  const builderSide = lock(path.join(ROOT, 'package-lock.json'))['node_modules/builder-util-runtime'].version;
  const updaterSide = lock(path.join(__dirname, 'package-lock.json'))['node_modules/builder-util-runtime'].version;
  assert.equal(updaterSide, builderSide);
});

test('every accepted advisory says why and until when', () => {
  for (const entry of baseline.acceptedAdvisories) {
    assert.match(entry.advisory, /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    assert.ok(entry.reason && entry.scope, entry.advisory);
    assert.match(entry.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  }
});
