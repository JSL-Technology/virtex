#!/usr/bin/env node
/**
 * Sign a release statement for every update manifest electron-builder produced.
 *
 *     node tools/desktop/sign-release-statements.mjs --dir <artifacts> --channel latest \
 *          [--expires-days 120] [--minimum-supported-version 1.4.2] [--release-notes-url https://…]
 *
 * For each `<channel>.yml`, `<channel>-mac.yml`, `<channel>-linux[-<arch>].yml` in --dir it writes
 * `<same base>.release.dsse.json`: a DSSE envelope over the statement the shell verifies before it
 * downloads anything (apps/desktop/src/release-verification.js — the same module signs here, so the
 * producer and the verifier cannot drift apart).
 *
 * Environment:
 *   DESKTOP_UPDATE_SIGNING_KEY      Ed25519 private key, PKCS#8 PEM (secret)
 *   DESKTOP_UPDATE_SIGNING_KEY_ID   its key id, as listed in DESKTOP_UPDATE_TRUSTED_KEYS
 *   DESKTOP_UPDATE_TRUSTED_KEYS     the public keys the build ships with; every statement is
 *                                   verified against them before this script exits 0
 *   GITHUB_SHA, GITHUB_RUN_ID, GITHUB_REPOSITORY   recorded as provenance in the statement
 *
 * Also used on a schedule to RE-SIGN the statements already published (fresh `expires`), so a
 * channel whose newest release is old does not stop updating clients that are behind it. That is the
 * freshness half of what TUF calls the timestamp role.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rv = require(join(ROOT, 'apps/desktop/src/release-verification.js'));
const yaml = require(join(ROOT, 'apps/desktop/node_modules/js-yaml'));

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    channel: { type: 'string', default: 'latest' },
    'expires-days': { type: 'string', default: '120' },
    'minimum-supported-version': { type: 'string' },
    'release-notes-url': { type: 'string' },
    // Re-signing: keep the mandatory floor and release notes of the statement already published.
    preserve: { type: 'boolean', default: false },
  },
});

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!values.dir) die('--dir is required');
const channel = values.channel;
if (!['latest', 'beta'].includes(channel)) die(`unknown channel ${channel}`);
const expiresDays = Number(values['expires-days']);
if (!Number.isInteger(expiresDays) || expiresDays < 7 || expiresDays > 365) die('--expires-days must be 7–365');
const minimum = values['minimum-supported-version'] ?? null;
if (minimum !== null && !rv.parseVersion(minimum)) die('--minimum-supported-version is not a semantic version');
const notesUrl = values['release-notes-url'] ?? null;
if (notesUrl !== null && !/^https:\/\//.test(notesUrl)) die('--release-notes-url must be https');

const keyId = process.env.DESKTOP_UPDATE_SIGNING_KEY_ID;
const pem = process.env.DESKTOP_UPDATE_SIGNING_KEY;
if (!keyId || !pem) die('DESKTOP_UPDATE_SIGNING_KEY and DESKTOP_UPDATE_SIGNING_KEY_ID are required');
const privateKey = createPrivateKey({ key: pem, format: 'pem' });
if (privateKey.asymmetricKeyType !== 'ed25519') die('the signing key must be Ed25519');

let trusted;
try {
  trusted = rv.loadTrustedKeys(JSON.parse(process.env.DESKTOP_UPDATE_TRUSTED_KEYS || '{}'));
} catch (error) {
  die(`DESKTOP_UPDATE_TRUSTED_KEYS: ${error.message}`);
}
// The key we sign with must be one the shipped build trusts, or every client would refuse the update.
const expectedPublic = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const shipped = trusted.get(keyId);
if (!shipped || !shipped.export({ type: 'spki', format: 'der' }).equals(expectedPublic)) {
  die(`key ${keyId} is not in DESKTOP_UPDATE_TRUSTED_KEYS (or its public half differs)`);
}

/** Map a manifest file name to the platform and architecture electron-updater reads it for. */
function targetOf(fileName) {
  const base = fileName.replace(/\.yml$/, '');
  if (base === channel) return { platform: 'win32', arch: null };
  if (base === `${channel}-mac`) return { platform: 'darwin', arch: null };
  if (base === `${channel}-linux`) return { platform: 'linux', arch: 'x64' };
  const linux = new RegExp(`^${channel}-linux-([a-z0-9]+)$`).exec(base);
  if (linux) return { platform: 'linux', arch: linux[1] };
  return null;
}

const manifests = readdirSync(values.dir).filter((name) => name.endsWith('.yml') && targetOf(name));
if (!manifests.length) die(`no ${channel} update manifests in ${values.dir}`);

const now = new Date();
const expires = new Date(now.getTime() + expiresDays * 86_400_000).toISOString();

for (const name of manifests) {
  const raw = readFileSync(join(values.dir, name));
  const manifest = yaml.load(raw.toString('utf8'));
  const { platform, arch } = targetOf(name);
  if (!manifest?.version || !Array.isArray(manifest.files) || !manifest.files.length) {
    die(`${name} has no version or files`);
  }
  // When re-signing, the published statement's mandatory floor and notes must survive: dropping
  // `minimumSupportedVersion` on refresh would silently turn a mandatory update into an optional one.
  // The old statement is verified first, so a tampered file on the server cannot inject a value.
  let carried = {};
  const previousPath = join(values.dir, name.replace(/\.yml$/, '.release.dsse.json'));
  if (values.preserve && existsSync(previousPath)) {
    let previous;
    try {
      previous = rv.openEnvelope(readFileSync(previousPath, 'utf8'), trusted);
    } catch (error) {
      die(`${name}: the published statement does not verify (${error.message}); refusing to re-sign over it`);
    }
    if (previous.version !== String(manifest.version)) {
      die(`${name}: published statement is for ${previous.version}, manifest is ${manifest.version}`);
    }
    carried = {
      ...(previous.minimumSupportedVersion ? { minimumSupportedVersion: previous.minimumSupportedVersion } : {}),
      ...(previous.releaseNotesUrl ? { releaseNotesUrl: previous.releaseNotesUrl } : {}),
    };
  }

  const statement = {
    schema: rv.STATEMENT_SCHEMA,
    product: rv.PRODUCT_ID,
    channel,
    platform,
    ...(platform === 'linux' ? { arch } : {}),
    version: String(manifest.version),
    releaseDate: manifest.releaseDate ?? now.toISOString(),
    signedAt: now.toISOString(),
    expires,
    files: manifest.files.map((file) => ({ url: file.url, sha512: file.sha512, size: file.size })),
    manifestSha512: createHash('sha512').update(raw).digest('base64'),
    ...carried,
    ...(minimum ? { minimumSupportedVersion: minimum } : {}),
    ...(notesUrl ? { releaseNotesUrl: notesUrl } : {}),
    provenance: {
      repository: process.env.GITHUB_REPOSITORY ?? null,
      commit: process.env.GITHUB_SHA ?? null,
      workflowRun: process.env.GITHUB_RUN_ID ?? null,
    },
  };
  if (!rv.parseVersion(statement.version)) die(`${name}: version ${statement.version} is not semantic`);

  const envelope = rv.signStatement(statement, keyId, privateKey);
  const envelopeText = `${JSON.stringify(envelope, null, 2)}\n`;

  // Verify exactly as a client will, from the bytes on disk, before calling this a success.
  rv.verifyRelease({
    envelopeText,
    trustedKeys: trusted,
    updateInfo: { version: statement.version, files: statement.files },
    currentVersion: '0.0.0',
    channel,
    platform,
    arch: arch ?? process.arch,
    now,
  });

  const out = name.replace(/\.yml$/, '.release.dsse.json');
  writeFileSync(join(values.dir, out), envelopeText);
  console.log(`✓ ${out}  ${platform}${arch ? `/${arch}` : ''}  ${statement.version}  expires ${expires.slice(0, 10)}`);
}
