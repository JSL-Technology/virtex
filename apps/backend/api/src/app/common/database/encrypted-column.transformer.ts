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
 * The stored form is `iv.ciphertext.tag`, each part base64url, matching the sealed-token format
 * used elsewhere. A value that does not have that shape is returned untouched on read: it was
 * written before the column was encrypted, or by a seed/fixture, and decrypting it would throw
 * where passing it through is both safe (it is already plaintext) and correct.
 */

const KEY_SALT = 'virtex-pii-column-salt';

let cachedKey: Buffer | null = null;

/**
 * The 256-bit key, derived once and cached.
 *
 * Fails closed in production: a payroll module that silently stored personal data under a
 * throwaway dev key would be worse than one that refused to start. In development a deterministic
 * fallback keeps tests and local runs working without a configured secret.
 */
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL: ENCRYPTION_SECRET is required to encrypt personal data (payroll) in production.',
      );
    }
    cachedKey = crypto.scryptSync('dev-pii-encryption-secret', KEY_SALT, 32);
    return cachedKey;
  }

  cachedKey = crypto.scryptSync(secret, KEY_SALT, 32);
  return cachedKey;
}

/** True when a stored value has the sealed `iv.ciphertext.tag` shape this transformer writes. */
function looksEncrypted(value: string): boolean {
  const parts = value.split('.');
  return (
    parts.length === 3 &&
    parts.every((part) => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part))
  );
}

function seal(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
}

function open(token: string): string {
  const [ivPart, dataPart, tagPart] = token.split('.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
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
  return crypto
    .createHmac('sha256', encryptionKey())
    .update(String(value).trim())
    .digest('hex');
}
