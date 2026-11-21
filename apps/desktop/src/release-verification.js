// Verification of a release before the shell installs it, as pure functions.
//
// ## Why a second signature, on top of the platform's own
//
// electron-updater already refuses a download whose SHA-512 differs from the one in the channel
// manifest (`latest.yml`), and on macOS and Windows the installer must also carry our code
// signature. What neither covers is the manifest itself: whoever can write to the update server
// (a leaked bucket credential, a compromised CDN, a DNS hijack with a valid certificate) can
// publish a manifest pointing at any file whose hash they choose. On Linux there is no code
// signature to stop them at all, and on every platform they can serve an OLD signed build that
// still carries a known vulnerability (a downgrade, which a code signature does not prevent).
//
// So every release also publishes a *release statement*, signed offline in CI with an Ed25519 key
// that never touches the update server. The statement names the product, channel, platform,
// version and the exact SHA-512 of every file; the shell trusts a manifest only when it matches a
// statement signed by a key it was built with. A server compromise then gains nothing: it can
// withhold updates, but it cannot make the shell install anything we did not sign.
//
// ## Why DSSE
//
// The envelope is DSSE (Dead Simple Signing Envelope, the format used by in-toto and Sigstore):
// the signature covers the payload *and its type* through PAE, so a signature made for one kind of
// document can never be replayed as another. It also carries a key id, which is what makes key
// rotation possible: the shell ships with every key currently trusted, CI signs with the newest,
// and an old key is retired by shipping a build without it.
//
// Kept free of Electron so `node --test` covers every branch.
'use strict';

const crypto = require('node:crypto');

const STATEMENT_PAYLOAD_TYPE = 'application/vnd.virtex.desktop-release+json';
const STATEMENT_SCHEMA = 1;
const PRODUCT_ID = 'io.virtex.desktop';

/** DSSE pre-authentication encoding: what is actually signed. */
function pae(payloadType, payload) {
  const type = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} `, 'utf8'),
    type,
    Buffer.from(` ${payload.length} `, 'utf8'),
    payload,
  ]);
}

/**
 * The manifest electron-updater reads, and therefore the statement that must vouch for it.
 *
 * Mirrors `Provider.getCustomChannelName` in electron-updater: Windows uses the bare channel,
 * macOS appends `-mac`, Linux appends `-linux` plus the architecture unless it is x64. A test pins
 * this so an updater upgrade that changes the convention fails here instead of in the field.
 */
function manifestBaseName(channel, platform, arch) {
  if (platform === 'linux') return `${channel}-linux${arch === 'x64' ? '' : `-${arch}`}`;
  if (platform === 'darwin') return `${channel}-mac`;
  return channel;
}

function statementFileName(channel, platform, arch) {
  return `${manifestBaseName(channel, platform, arch)}.release.dsse.json`;
}

// ── Semantic versions (SemVer 2.0.0 precedence, §11) ────────────────────────────────────────────

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

function parseVersion(version) {
  const match = SEMVER.exec(String(version ?? ''));
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

/** -1, 0 or 1. Throws on a value that is not a version: comparing garbage must not mean "equal". */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`Not a semantic version: ${!left ? a : b}`);
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  }
  if (!left.pre.length || !right.pre.length) {
    if (left.pre.length === right.pre.length) return 0;
    return left.pre.length ? -1 : 1; // a pre-release precedes its release
  }
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

// ── Keys ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Turn the configured trust set into KeyObjects.
 *
 * `trustedKeys` maps a key id to an Ed25519 public key in PEM (SPKI). Anything that is not an
 * Ed25519 key is rejected outright: accepting "whatever key type the PEM says" is how an RSA key
 * with a weak exponent, or a key meant for another purpose, ends up trusted.
 */
function loadTrustedKeys(trustedKeys) {
  const keys = new Map();
  for (const [keyId, pem] of Object.entries(trustedKeys ?? {})) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) throw new Error(`Invalid key id: ${keyId}`);
    const key = crypto.createPublicKey({ key: String(pem), format: 'pem' });
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error(`Key ${keyId} is ${key.asymmetricKeyType}, expected ed25519`);
    }
    keys.set(keyId, key);
  }
  return keys;
}

/** Sign a statement (used by CI; exported so the tests exercise the real producer). */
function signStatement(statement, keyId, privateKey) {
  const payload = Buffer.from(JSON.stringify(statement), 'utf8');
  const sig = crypto.sign(null, pae(STATEMENT_PAYLOAD_TYPE, payload), privateKey);
  return {
    payloadType: STATEMENT_PAYLOAD_TYPE,
    payload: payload.toString('base64'),
    signatures: [{ keyid: keyId, sig: sig.toString('base64') }],
  };
}

// ── Verification ────────────────────────────────────────────────────────────────────────────────

class ReleaseVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReleaseVerificationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseVerificationError(code, message);
}

const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

/**
 * Open a DSSE envelope and return its statement, or throw.
 *
 * At least one signature must verify under a trusted key; signatures by unknown keys are ignored
 * (a rotation publishes the new key's signature alongside the old one).
 */
function openEnvelope(envelopeText, trustedKeys) {
  let envelope;
  try {
    envelope = JSON.parse(envelopeText);
  } catch {
    fail('ENVELOPE_MALFORMED', 'The release statement is not JSON');
  }
  if (!envelope || envelope.payloadType !== STATEMENT_PAYLOAD_TYPE) {
    fail('ENVELOPE_TYPE', 'The release statement has an unexpected payload type');
  }
  if (typeof envelope.payload !== 'string' || !Array.isArray(envelope.signatures)) {
    fail('ENVELOPE_MALFORMED', 'The release statement is missing its payload or signatures');
  }
  const payload = Buffer.from(envelope.payload, 'base64');
  const signed = pae(STATEMENT_PAYLOAD_TYPE, payload);

  const verified = envelope.signatures.some((entry) => {
    const key = entry && trustedKeys.get(entry.keyid);
    if (!key || typeof entry.sig !== 'string') return false;
    try {
      return crypto.verify(null, signed, key, Buffer.from(entry.sig, 'base64'));
    } catch {
      return false;
    }
  });
  if (!verified) fail('SIGNATURE_INVALID', 'No valid signature from a trusted key');

  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    return fail('STATEMENT_MALFORMED', 'The signed statement is not JSON');
  }
}

/**
 * Decide whether an update electron-updater offers may be installed.
 *
 * @param {object} input
 * @param {string} input.envelopeText   The `.release.dsse.json` fetched next to the manifest.
 * @param {Map<string, crypto.KeyObject>} input.trustedKeys
 * @param {{version: string, files: Array<{url: string, sha512: string, size?: number}>}} input.updateInfo
 *        What electron-updater parsed from the manifest it intends to act on.
 * @param {string} input.currentVersion
 * @param {string} input.channel
 * @param {string} input.platform  `process.platform`
 * @param {string} input.arch      `process.arch`
 * @param {Date}   [input.now]
 * @returns {{ version: string, minimumSupportedVersion: string | null, mandatory: boolean,
 *             releaseNotesUrl: string | null }}
 */
function verifyRelease(input) {
  const statement = openEnvelope(input.envelopeText, input.trustedKeys);

  if (statement.schema !== STATEMENT_SCHEMA) fail('STATEMENT_SCHEMA', 'Unsupported statement schema');
  if (statement.product !== PRODUCT_ID) fail('STATEMENT_PRODUCT', 'Statement is for another product');
  if (statement.channel !== input.channel) fail('STATEMENT_CHANNEL', 'Statement is for another channel');
  if (statement.platform !== input.platform) fail('STATEMENT_PLATFORM', 'Statement is for another platform');
  if (statement.platform === 'linux' && statement.arch !== input.arch) {
    fail('STATEMENT_ARCH', 'Statement is for another architecture');
  }

  // The statement must describe exactly the release the manifest offers.
  if (statement.version !== input.updateInfo.version) {
    fail('VERSION_MISMATCH', 'The manifest offers a version the statement does not vouch for');
  }
  // Never move backwards, even if both documents agree: a replayed old statement is still validly
  // signed, and an old build is exactly what an attacker would want installed.
  if (compareVersions(statement.version, input.currentVersion) <= 0) {
    fail('NOT_NEWER', 'The offered version is not newer than the installed one');
  }

  // A statement has a lifetime, so a captured one cannot be replayed indefinitely to freeze clients
  // on a release we have since withdrawn (`expires` is set by CI; see tools/desktop).
  const now = input.now ?? new Date();
  if (typeof statement.expires !== 'string' || Number.isNaN(Date.parse(statement.expires))) {
    fail('STATEMENT_EXPIRY', 'The statement carries no valid expiry');
  }
  if (Date.parse(statement.expires) <= now.getTime()) fail('STATEMENT_EXPIRED', 'The statement has expired');

  const signedFiles = new Map();
  for (const file of Array.isArray(statement.files) ? statement.files : []) {
    if (typeof file?.url !== 'string' || !SHA512_BASE64.test(file?.sha512 ?? '')) {
      fail('STATEMENT_FILES', 'The statement lists a malformed file');
    }
    signedFiles.set(file.url, file);
  }
  const offered = Array.isArray(input.updateInfo.files) ? input.updateInfo.files : [];
  if (!offered.length) fail('MANIFEST_FILES', 'The manifest lists no files');
  for (const file of offered) {
    const signedFile = signedFiles.get(file.url);
    if (!signedFile) fail('FILE_NOT_SIGNED', `The manifest offers a file the statement does not list: ${file.url}`);
    if (signedFile.sha512 !== file.sha512) fail('FILE_HASH_MISMATCH', `Hash mismatch for ${file.url}`);
    if (signedFile.size !== undefined && file.size !== undefined && signedFile.size !== file.size) {
      fail('FILE_SIZE_MISMATCH', `Size mismatch for ${file.url}`);
    }
  }

  const minimum = statement.minimumSupportedVersion ?? null;
  if (minimum !== null && !parseVersion(minimum)) fail('STATEMENT_MINIMUM', 'Invalid minimum supported version');

  return {
    version: statement.version,
    minimumSupportedVersion: minimum,
    // The installed build is below the floor this release declares: it has a defect serious enough
    // that we no longer let it run (see updater.js for what that means for the person using it).
    mandatory: minimum !== null && compareVersions(input.currentVersion, minimum) < 0,
    releaseNotesUrl: typeof statement.releaseNotesUrl === 'string' ? statement.releaseNotesUrl : null,
  };
}

module.exports = {
  STATEMENT_PAYLOAD_TYPE,
  STATEMENT_SCHEMA,
  PRODUCT_ID,
  ReleaseVerificationError,
  pae,
  manifestBaseName,
  statementFileName,
  parseVersion,
  compareVersions,
  loadTrustedKeys,
  signStatement,
  openEnvelope,
  verifyRelease,
};
