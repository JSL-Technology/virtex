import * as crypto from 'crypto';
import { ValueTransformer } from 'typeorm';

/**
 * Column-level encryption for personal data at rest (cédula, bank account number).
 *
 * ## Why the payroll register needs this
 *
 * An employee's national id and bank account are the two fields a leak of the `employees` table
 * turns into identity theft and misdirected wages. They must never sit in the database in the
 * clear, and they must not be readable from a database backup, a replica, or a DBA's `SELECT *`.
 * Row-level security scopes *which tenant* sees a row; it does nothing about what the bytes say to
 * anyone holding the storage. So these columns are sealed with authenticated encryption and only
 * the application, holding the key, can read them.
 *
 * ## Construction
 *
 * AES-256-GCM, the same primitive `OauthStateService` and the e-CF certificate store already use
 * here, so there is one cryptographic idiom in the codebase rather than several. The key is derived
 * once, with `scrypt`, from `ENCRYPTION_SECRET` — the secret `env.validation.ts` already declares
 * mandatory in production. A fresh 96-bit IV per value means the same cédula encrypts to a
 * different ciphertext every time, so the column does not leak equality; the 128-bit GCM tag makes
 * tampering a decrypt failure rather than a silently wrong number.
 *
 * ## Key versioning, so the secret can be rotated
 *
 * The stored form is `keyId.iv.ciphertext.tag`, each part base64url. The leading `keyId` names which
 * key sealed the value, so rotation is possible: point `ENCRYPTION_SECRET` at the new secret, keep
 * the old one in `ENCRYPTION_SECRET_PREVIOUS`, and a re-encryption pass can read every row (old rows
 * decrypt under the previous key, new rows under the current) and rewrite it under the current key.
 * Without the id, rotating the secret would leave every stored cédula and bank account permanently
 * undecryptable. The legacy 3-part form written before versioning still decrypts under the current
 * key, so this is backward compatible.
 *
 * A value that does not have a sealed shape is returned untouched on read: it was written before the
 * column was encrypted, or by a seed/fixture, and decrypting it would throw where passing it through
 * is both safe (it is already plaintext) and correct.
 */

const KEY_SALT = 'virtex-pii-column-salt';

/** The id written into new ciphertext; the current key. Bump when a new secret is introduced. */
const CURRENT_KEY_ID = 'v1';
/** The id the previous secret is registered under, for reads during a rotation window. */
const PREVIOUS_KEY_ID = 'v0';

const keyring = new Map<string, Buffer>();

/**
 * The keyring: the current key (and, if configured for a rotation, the previous one).
 *
 * Fails closed in production: a payroll module that silently stored personal data under a throwaway
 * dev key would be worse than one that refused to start. In development a deterministic fallback
 * keeps tests and local runs working without a configured secret.
 */
function keyFor(keyId: string): Buffer {
  const cached = keyring.get(keyId);
  if (cached) return cached;

  if (keyId === PREVIOUS_KEY_ID) {
    const previous = process.env.ENCRYPTION_SECRET_PREVIOUS;
    if (!previous) {
      throw new Error(
        'Cannot decrypt a value sealed with the previous key: ENCRYPTION_SECRET_PREVIOUS is not set.',
      );
    }
    const derived = crypto.scryptSync(previous, KEY_SALT, 32);
    keyring.set(keyId, derived);
    return derived;
  }

  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL: ENCRYPTION_SECRET is required to encrypt personal data (payroll) in production.',
      );
    }
    const derived = crypto.scryptSync('dev-pii-encryption-secret', KEY_SALT, 32);
    keyring.set(keyId, derived);
    return derived;
  }

  const derived = crypto.scryptSync(secret, KEY_SALT, 32);
  keyring.set(keyId, derived);
  return derived;
}

/**
 * True when a stored value has a sealed shape this transformer wrote — either the versioned
 * `keyId.iv.ciphertext.tag` (4 parts) or the legacy `iv.ciphertext.tag` (3 parts).
 *
 * The parts are base64url and non-empty. A plaintext value that happens to look like this is
 * astronomically unlikely for a cédula or an account number, and if one did occur the GCM tag would
 * fail to authenticate on read, which surfaces as a decrypt error rather than a silently wrong value.
 */
function looksEncrypted(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 3 && parts.length !== 4) return false;
  return parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part));
}

function seal(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(CURRENT_KEY_ID), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CURRENT_KEY_ID,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

function open(token: string): string {
  const parts = token.split('.');
  // 4 parts: versioned `keyId.iv.ct.tag`. 3 parts: legacy, sealed under the current key.
  const [keyId, ivPart, dataPart, tagPart] =
    parts.length === 4 ? parts : [CURRENT_KEY_ID, ...parts];
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    keyFor(keyId),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * A TypeORM transformer that encrypts on write and decrypts on read.
 *
 * Declared on a `text` column: the sealed form is longer than the plaintext and is not a number, a
 * date, or anything a database index over the value would be meaningful on. When a column must be
 * looked up or kept unique without being decrypted, store a {@link blindIndex} of it alongside.
 */
export const encryptedColumnTransformer: ValueTransformer = {
  to: (value: string | null | undefined): string | null => {
    if (value === null || value === undefined || value === '') return null;
    return seal(String(value));
  },
  from: (value: string | null): string | null => {
    if (value === null || value === undefined || value === '') return null;
    if (!looksEncrypted(value)) return value;
    return open(value);
  },
};

/**
 * A deterministic, keyed fingerprint of a sensitive value, for lookup and uniqueness.
 *
 * Encryption is non-deterministic on purpose, so the ciphertext cannot be searched or constrained
 * unique. A blind index — HMAC-SHA-256 under the same secret — is deterministic, so two rows with
 * the same cédula produce the same index and a unique constraint on it enforces "one employee per
 * cédula per tenant" without the database ever seeing the cédula itself. It is keyed rather than a
 * plain hash so the short, low-entropy space of a national id cannot be brute-forced from a leaked
 * index alone.
 */
export function blindIndex(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  // Keyed on the current key. A secret rotation therefore requires recomputing blind indexes in the
  // same pass that re-encrypts the columns — both are functions of the same key by design.
  return crypto
    .createHmac('sha256', keyFor(CURRENT_KEY_ID))
    .update(String(value).trim())
    .digest('hex');
}
