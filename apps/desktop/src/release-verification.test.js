'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const rv = require('./release-verification');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519');
const TRUSTED = rv.loadTrustedKeys({ 'k-2026': publicKey.export({ type: 'spki', format: 'pem' }) });

const SHA = (seed) => crypto.createHash('sha512').update(seed).digest('base64');
const FILES = [
  { url: 'Virtex-Desktop-1.4.0-arm64-mac.zip', sha512: SHA('arm'), size: 1000 },
  { url: 'Virtex-Desktop-1.4.0-x64-mac.zip', sha512: SHA('x64'), size: 2000 },
];

function statement(overrides = {}) {
  return {
    schema: 1,
    product: 'io.virtex.desktop',
    channel: 'latest',
    platform: 'darwin',
    version: '1.4.0',
    expires: new Date(Date.now() + 86_400_000).toISOString(),
    files: FILES,
    ...overrides,
  };
}

function input(overrides = {}, statementOverrides = {}, key = privateKey, keyId = 'k-2026') {
  return {
    envelopeText: JSON.stringify(rv.signStatement(statement(statementOverrides), keyId, key)),
    trustedKeys: TRUSTED,
    updateInfo: { version: '1.4.0', files: FILES },
    currentVersion: '1.3.2',
    channel: 'latest',
    platform: 'darwin',
    arch: 'arm64',
    ...overrides,
  };
}

function rejects(args, code) {
  assert.throws(() => rv.verifyRelease(args), (error) => error instanceof rv.ReleaseVerificationError && error.code === code);
}

test('DSSE pre-authentication encoding matches the specification test vector', () => {
  // https://github.com/secure-systems-lab/dsse/blob/master/protocol.md
  assert.equal(
    rv.pae('http://example.com/HelloWorld', Buffer.from('hello world')).toString(),
    'DSSEv1 29 http://example.com/HelloWorld 11 hello world',
  );
});

test('a statement signed by a trusted key, matching the manifest, verifies', () => {
  const verdict = rv.verifyRelease(input());
  assert.deepEqual(verdict, { version: '1.4.0', minimumSupportedVersion: null, mandatory: false, releaseNotesUrl: null });
});

test('signatures: an untrusted key, an unknown key id, or a tampered payload is refused', () => {
  rejects(input({}, {}, other.privateKey), 'SIGNATURE_INVALID');
  rejects(input({}, {}, privateKey, 'k-unknown'), 'SIGNATURE_INVALID');

  const envelope = rv.signStatement(statement(), 'k-2026', privateKey);
  const tampered = JSON.parse(Buffer.from(envelope.payload, 'base64').toString());
  tampered.files[0].sha512 = SHA('evil');
  envelope.payload = Buffer.from(JSON.stringify(tampered)).toString('base64');
  rejects({ ...input(), envelopeText: JSON.stringify(envelope) }, 'SIGNATURE_INVALID');

  // The payload type is covered by the signature: relabelling the envelope breaks it.
  const relabelled = rv.signStatement(statement(), 'k-2026', privateKey);
  relabelled.payloadType = 'application/json';
  rejects({ ...input(), envelopeText: JSON.stringify(relabelled) }, 'ENVELOPE_TYPE');
  rejects({ ...input(), envelopeText: 'not json' }, 'ENVELOPE_MALFORMED');
});

test('a key rotation: the new key verifies alongside the old one, an unknown signature is ignored', () => {
  const rotated = rv.loadTrustedKeys({
    'k-2026': publicKey.export({ type: 'spki', format: 'pem' }),
    'k-2027': other.publicKey.export({ type: 'spki', format: 'pem' }),
  });
  const envelope = rv.signStatement(statement(), 'k-2027', other.privateKey);
  envelope.signatures.unshift({ keyid: 'k-retired', sig: 'AAAA' });
  assert.equal(rv.verifyRelease({ ...input(), trustedKeys: rotated, envelopeText: JSON.stringify(envelope) }).version, '1.4.0');
});

test('the statement must be for this product, channel, platform and architecture', () => {
  rejects(input({}, { product: 'io.other.app' }), 'STATEMENT_PRODUCT');
  rejects(input({}, { channel: 'beta' }), 'STATEMENT_CHANNEL');
  rejects(input({}, { platform: 'win32' }), 'STATEMENT_PLATFORM');
  rejects(input({ platform: 'linux', arch: 'x64' }, { platform: 'linux', arch: 'arm64' }), 'STATEMENT_ARCH');
  rejects(input({}, { schema: 2 }), 'STATEMENT_SCHEMA');
});

test('the manifest may offer only what the statement names, byte for byte', () => {
  rejects(input({ updateInfo: { version: '1.5.0', files: FILES } }), 'VERSION_MISMATCH');
  rejects(input({ updateInfo: { version: '1.4.0', files: [{ ...FILES[0], url: 'evil.zip' }] } }), 'FILE_NOT_SIGNED');
  rejects(input({ updateInfo: { version: '1.4.0', files: [{ ...FILES[0], sha512: SHA('evil') }] } }), 'FILE_HASH_MISMATCH');
  rejects(input({ updateInfo: { version: '1.4.0', files: [{ ...FILES[0], size: 1 }] } }), 'FILE_SIZE_MISMATCH');
  rejects(input({ updateInfo: { version: '1.4.0', files: [] } }), 'MANIFEST_FILES');
  rejects(input({}, { files: [{ url: 'x', sha512: 'short' }] }), 'STATEMENT_FILES');
});

test('never a downgrade or a re-install, even with a valid signature', () => {
  rejects(input({ currentVersion: '1.4.0' }), 'NOT_NEWER');
  rejects(input({ currentVersion: '2.0.0' }), 'NOT_NEWER');
});

test('an expired or undated statement is refused', () => {
  rejects(input({}, { expires: new Date(Date.now() - 1000).toISOString() }), 'STATEMENT_EXPIRED');
  rejects(input({}, { expires: undefined }), 'STATEMENT_EXPIRY');
  rejects(input({ now: new Date(Date.now() + 2 * 86_400_000) }), 'STATEMENT_EXPIRED');
});

test('a minimum supported version above the installed one makes the update mandatory', () => {
  assert.equal(rv.verifyRelease(input({}, { minimumSupportedVersion: '1.3.5' })).mandatory, true);
  assert.equal(rv.verifyRelease(input({}, { minimumSupportedVersion: '1.3.2' })).mandatory, false);
  rejects(input({}, { minimumSupportedVersion: 'soon' }), 'STATEMENT_MINIMUM');
});

test('semantic version precedence follows SemVer 2.0.0 §11', () => {
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    assert.equal(rv.compareVersions(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < ${ordered[i + 1]}`);
    assert.equal(rv.compareVersions(ordered[i + 1], ordered[i]), 1);
  }
  assert.equal(rv.compareVersions('1.2.3+build.5', '1.2.3'), 0);
  assert.throws(() => rv.compareVersions('1.2', '1.2.0'));
});

test('only Ed25519 public keys are accepted as trust anchors', () => {
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => rv.loadTrustedKeys({ rsa }), /expected ed25519/);
  assert.throws(() => rv.loadTrustedKeys({ 'bad id!': publicKey.export({ type: 'spki', format: 'pem' }) }), /Invalid key id/);
});

test('the statement name follows the manifest electron-updater actually reads', () => {
  // Bind to electron-updater's own convention, so an updater upgrade that changes it fails here.
  const { Provider } = require(path.join(__dirname, '..', 'node_modules', 'electron-updater', 'out', 'providers', 'Provider.js'));
  const original = process.env.TEST_UPDATER_ARCH;
  try {
    for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['linux', 'x64'], ['linux', 'arm64']]) {
      process.env.TEST_UPDATER_ARCH = arch;
      const theirs = Provider.prototype.getCustomChannelName.call(
        { runtimeOptions: { platform }, getChannelFilePrefix: Provider.prototype.getChannelFilePrefix },
        'latest',
      );
      assert.equal(rv.manifestBaseName('latest', platform, arch), theirs, `${platform}/${arch}`);
    }
  } finally {
    if (original === undefined) delete process.env.TEST_UPDATER_ARCH;
    else process.env.TEST_UPDATER_ARCH = original;
  }
  assert.equal(rv.statementFileName('beta', 'linux', 'arm64'), 'beta-linux-arm64.release.dsse.json');
});
