'use strict';
// The release tooling end to end: generate a key, write a configuration, sign the manifests
// electron-builder produces, and verify each statement exactly as an installed client would.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const rv = require('./src/release-verification');

const ROOT = path.resolve(__dirname, '..', '..');
const TOOLS = path.join(ROOT, 'tools', 'desktop');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vx-release-'));
}

function keys(dir, id) {
  const out = execFileSync(process.execPath, [path.join(TOOLS, 'generate-update-keys.mjs'), path.join(dir, `${id}.pem`), id], { encoding: 'utf8' });
  return { pem: fs.readFileSync(path.join(dir, `${id}.pem`), 'utf8'), trusted: JSON.parse(out.trim().split('\n').at(-1)) };
}

const sha = (seed) => crypto.createHash('sha512').update(seed).digest('base64');
function manifest(version, files) {
  return `version: ${version}\nfiles:\n${files.map((f) => `  - url: ${f}\n    sha512: ${sha(f)}\n    size: 123\n`).join('')}path: ${files[0]}\nsha512: ${sha(files[0])}\nreleaseDate: '2026-11-08T00:00:00.000Z'\n`;
}

function sign(dir, key, extra = [], trusted = key.trusted) {
  return spawnSync(process.execPath, [path.join(TOOLS, 'sign-release-statements.mjs'), '--dir', dir, '--channel', 'latest', ...extra], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DESKTOP_UPDATE_SIGNING_KEY: key.pem,
      DESKTOP_UPDATE_SIGNING_KEY_ID: Object.keys(key.trusted)[0],
      DESKTOP_UPDATE_TRUSTED_KEYS: JSON.stringify(trusted),
    },
  });
}

test('the key generator never overwrites a key and prints a usable trust entry', () => {
  const dir = tmp();
  const key = keys(dir, 'k-test');
  assert.equal(fs.statSync(path.join(dir, 'k-test.pem')).mode & 0o777, 0o600);
  assert.equal(rv.loadTrustedKeys(key.trusted).size, 1);
  const again = spawnSync(process.execPath, [path.join(TOOLS, 'generate-update-keys.mjs'), path.join(dir, 'k-test.pem')], { encoding: 'utf8' });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /refusing to overwrite/);
});

test('every platform manifest gets a statement a client verifies', () => {
  const dir = tmp();
  const key = keys(dir, 'k-test');
  fs.writeFileSync(path.join(dir, 'latest.yml'), manifest('1.4.0', ['Virtex-Desktop-Setup-1.4.0.exe']));
  fs.writeFileSync(path.join(dir, 'latest-mac.yml'), manifest('1.4.0', ['Virtex-Desktop-1.4.0-arm64-mac.zip', 'Virtex-Desktop-1.4.0-x64-mac.zip']));
  fs.writeFileSync(path.join(dir, 'latest-linux.yml'), manifest('1.4.0', ['Virtex-Desktop-1.4.0.AppImage']));
  fs.writeFileSync(path.join(dir, 'latest-linux-arm64.yml'), manifest('1.4.0', ['Virtex-Desktop-1.4.0-arm64.AppImage']));
  fs.writeFileSync(path.join(dir, 'beta.yml'), manifest('1.5.0-beta.1', ['ignored.exe'])); // other channel: untouched

  const result = sign(dir, key);
  assert.equal(result.status, 0, result.stderr);
  const trusted = rv.loadTrustedKeys(key.trusted);
  for (const [file, platform, arch] of [
    ['latest', 'win32', 'x64'],
    ['latest-mac', 'darwin', 'arm64'],
    ['latest-linux', 'linux', 'x64'],
    ['latest-linux-arm64', 'linux', 'arm64'],
  ]) {
    assert.equal(rv.statementFileName('latest', platform, arch), `${file}.release.dsse.json`);
    const envelopeText = fs.readFileSync(path.join(dir, `${file}.release.dsse.json`), 'utf8');
    const statement = rv.openEnvelope(envelopeText, trusted);
    assert.equal(statement.platform, platform);
    assert.equal(statement.manifestSha512, crypto.createHash('sha512').update(fs.readFileSync(path.join(dir, `${file}.yml`))).digest('base64'));
    const verdict = rv.verifyRelease({
      envelopeText,
      trustedKeys: trusted,
      updateInfo: { version: '1.4.0', files: statement.files },
      currentVersion: '1.3.0',
      channel: 'latest',
      platform,
      arch,
    });
    assert.equal(verdict.version, '1.4.0');
  }
  assert.equal(fs.existsSync(path.join(dir, 'beta.release.dsse.json')), false);
});

test('re-signing preserves a mandatory floor and refuses a tampered published statement', () => {
  const dir = tmp();
  const key = keys(dir, 'k-test');
  fs.writeFileSync(path.join(dir, 'latest-linux.yml'), manifest('1.4.0', ['Virtex-Desktop-1.4.0.AppImage']));
  assert.equal(sign(dir, key, ['--minimum-supported-version', '1.3.9']).status, 0);

  assert.equal(sign(dir, key, ['--preserve']).status, 0);
  const trusted = rv.loadTrustedKeys(key.trusted);
  const statement = rv.openEnvelope(fs.readFileSync(path.join(dir, 'latest-linux.release.dsse.json'), 'utf8'), trusted);
  assert.equal(statement.minimumSupportedVersion, '1.3.9');

  // Someone with write access to the bucket edits the published statement: re-signing must stop.
  const file = path.join(dir, 'latest-linux.release.dsse.json');
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString());
  delete payload.minimumSupportedVersion;
  envelope.payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  fs.writeFileSync(file, JSON.stringify(envelope));
  const refused = sign(dir, key, ['--preserve']);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /does not verify/);
});

test('a signing key the shipped build does not trust is refused before anything is written', () => {
  const dir = tmp();
  const key = keys(dir, 'k-test');
  const stranger = keys(dir, 'k-other');
  fs.writeFileSync(path.join(dir, 'latest.yml'), manifest('1.4.0', ['Virtex-Desktop-Setup-1.4.0.exe']));
  const result = sign(dir, key, [], stranger.trusted);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not in DESKTOP_UPDATE_TRUSTED_KEYS/);
  assert.equal(fs.existsSync(path.join(dir, 'latest.release.dsse.json')), false);
});

test('the configuration writer validates with the same rules the shell starts with', () => {
  const dir = tmp();
  const key = keys(dir, 'k-test');
  const run = (env) =>
    spawnSync(process.execPath, [path.join(TOOLS, 'write-app-config.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
  const bad = run({ DESKTOP_PORTAL_URL: 'http://app.virtex.io', DESKTOP_POS_URL: 'https://pos.virtex.io', DESKTOP_UPDATE_FEED_URL: 'https://u.virtex.io', DESKTOP_UPDATE_TRUSTED_KEYS: JSON.stringify(key.trusted) });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /must use https/);
});
