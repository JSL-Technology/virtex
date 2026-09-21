import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * The one place this application encrypts data at rest.
 *
 * ## Why there is exactly one
 *
 * There were three, and they did not agree. `CryptoUtil`, `TokenService.encryptIp` and
 * `SecretEncryptionService` each derived their own key from `ENCRYPTION_SECRET` + `AUTH_SALT` and
 * each serialised the result differently — `iv:tag:ct` here, `iv:ct:tag` in the other two. That is
 * not a stylistic difference: `refresh_tokens.encrypted_ip` was written by BOTH
 * `TokenService.encryptIp` (on issue) and `SessionService.encryptIp` → this class (on refresh), so
 * one column held two mutually unreadable formats. Nothing read the column, so nothing ever
 * noticed; the forensic capability it exists to provide did not exist.
 *
 * A comment in `session.service.ts` claimed this had been fixed and that the third derivation was
 * "removed". It had been removed from one caller. Now there is one implementation, and
 * `tools/verify/crypto-single-derivation.mjs` fails the build if a second one appears.
 *
 * ## Format
 *
 * New values are written as `v2:iv:ct:tag`, all hex. The version prefix is what makes the next
 * migration possible without another round of trial decryption, and it distinguishes a current
 * value from the two historical three-part shapes at a glance.
 *
 * ## Reading what is already stored
 *
 * `decrypt` accepts, in order:
 *
 *  - `v2:iv:ct:tag` — current.
 *  - `iv:tag:ct`    — this class before versioning (TOTP secrets, half of `encrypted_ip`).
 *  - `iv:ct:tag`    — `SecretEncryptionService` and `TokenService` (IdP client secrets, the other
 *                     half of `encrypted_ip`).
 *  - `iv:ct`        — the original AES-256-CBC values.
 *
 * The two three-part shapes are ambiguous by inspection, so they are resolved by trial: GCM
 * authenticates, therefore the wrong interpretation fails cleanly rather than returning plausible
 * garbage. Every candidate is also tried against each key in the ring.
 *
 * ## Key rotation
 *
 * `ENCRYPTION_SECRET_PREVIOUS` is accepted for DECRYPTION only. Writing always uses the current
 * secret, so data re-encrypts itself as it is touched and the old secret can be dropped once the
 * longest-lived ciphertext has been rewritten. This mirrors `RS_RETIRED_PUBLIC_KEYS` in
 * `KeyManagementService`, which is the same idea for signing keys.
 */
@Injectable()
export class CryptoUtil {
  private readonly logger = new Logger(CryptoUtil.name);

  private readonly algorithm = 'aes-256-gcm';
  /** GCM's standard IV width (96 bits). */
  private readonly ivLength = 12;
  /** GCM's authentication tag width (128 bits). */
  private readonly tagLength = 16;
  private static readonly VERSION = 'v2';

  /** The key new data is written with. */
  private readonly key: Buffer;
  /** Every key that may decrypt, newest first. Includes `key`. */
  private readonly decryptionKeys: Buffer[];

  constructor(private configService: ConfigService) {
    // `getOrThrow`, not `get` with a literal fallback. The previous implementation fell back to
    // the salt `'default-salt-change-me-in-prod'` whenever `AUTH_SALT` was absent and NODE_ENV was
    // not exactly `production` — a value that `auth.config.ts` itself classifies as an insecure
    // placeholder, on a path that classification never reached. Both variables are in
    // `CRYPTOGRAPHIC_SECRETS`, so the schema already guarantees they exist.
    const secret = this.configService.getOrThrow<string>('ENCRYPTION_SECRET');
    const salt = this.configService.getOrThrow<string>('AUTH_SALT');

    this.key = crypto.scryptSync(secret, salt, 32);

    const keys = [this.key];

    // Rotation: the outgoing secret still decrypts what it wrote.
    const previous = this.configService.get<string>('ENCRYPTION_SECRET_PREVIOUS');
    if (previous?.trim()) {
      keys.push(crypto.scryptSync(previous, salt, 32));
      this.logger.log(
        { event: 'encryption_key_rotation_active' },
        'ENCRYPTION_SECRET_PREVIOUS is set: decrypting with two keys, writing with the current one.',
      );
    }

    // Pre-L-13 data was keyed from the literal salt `'salt'`. Decrypt-only, forever cheap to keep.
    keys.push(crypto.scryptSync(secret, 'salt', 32));

    this.decryptionKeys = keys;
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${CryptoUtil.VERSION}:${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
  }

  decrypt(text: string): string {
    const parts = text.split(':');

    if (parts[0] === CryptoUtil.VERSION && parts.length === 4) {
      const [, iv, ct, tag] = parts;
      return this.tryKeys((key) => this.gcm(key, iv, ct, tag));
    }

    if (parts.length === 3) {
      const [iv, second, third] = parts;
      // Ambiguous by shape, resolved by authentication: `iv:tag:ct` first because that is what this
      // class wrote, `iv:ct:tag` second for the values the other two services wrote.
      return this.tryKeys((key) => {
        try {
          return this.gcm(key, iv, third, second);
        } catch {
          return this.gcm(key, iv, second, third);
        }
      });
    }

    if (parts.length === 2) {
      const [iv, ct] = parts;
      return this.tryKeys((key) => this.cbc(key, iv, ct));
    }

    throw new Error('Invalid encryption format');
  }

  /**
   * Whether a stored value is already in the current format.
   *
   * Used by the re-encryption sweep so it can skip what it has already rewritten, and by
   * `verify:crypto` to report how much of the estate is still on a legacy shape.
   */
  static isCurrentFormat(value: string): boolean {
    return value.startsWith(`${CryptoUtil.VERSION}:`) && value.split(':').length === 4;
  }

  /** Try each key in the ring, newest first, and report only that it failed. */
  private tryKeys(attempt: (key: Buffer) => string): string {
    for (const key of this.decryptionKeys) {
      try {
        return attempt(key);
      } catch {
        // Next key. A failure here is indistinguishable from "wrong key" by design.
      }
    }
    throw new Error('Failed to decrypt: no key in the ring authenticated this value');
  }

  private gcm(key: Buffer, ivHex: string, ctHex: string, tagHex: string): string {
    const tag = Buffer.from(tagHex, 'hex');
    if (tag.length !== this.tagLength) {
      throw new Error('Authentication tag has the wrong length');
    }
    const decipher = crypto.createDecipheriv(this.algorithm, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ctHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  private cbc(key: Buffer, ivHex: string, ctHex: string): string {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    let out = decipher.update(ctHex, 'hex', 'utf8');
    out += decipher.final('utf8');
    return out;
  }
}
