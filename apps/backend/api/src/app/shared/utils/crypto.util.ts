
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class CryptoUtil {
  private readonly algorithm = 'aes-256-gcm';
  // L-13 FIX: Single, centralized key derivation for ENCRYPTION_SECRET using the configured
  // AUTH_SALT instead of the predictable literal 'salt' (CWE-760). A legacy key derived from
  // the old literal salt is retained ONLY for decryption, so previously-encrypted data (e.g.
  // TOTP secrets) keeps working without a forced migration. New data is always written with
  // the current key, enabling gradual re-encryption / key rotation.
  private readonly key: Buffer;
  private readonly legacyKey: Buffer;
  // GCM standard IV is 12 bytes (96 bits)
  private readonly ivLength = 12;

  constructor(private configService: ConfigService) {
    const secret = this.configService.getOrThrow<string>('ENCRYPTION_SECRET');
    const salt = this.configService.get<string>('AUTH_SALT');
    if (process.env['NODE_ENV'] === 'production' && !salt) {
      throw new Error('AUTH_SALT is required in production for 2FA secret encryption');
    }
    const effectiveSalt = salt || 'default-salt-change-me-in-prod';
    // Ensure key is 32 bytes for AES-256
    this.key = crypto.scryptSync(secret, effectiveSalt, 32);
    // Legacy key (pre L-13): derived from the static literal salt. Decrypt-only fallback.
    this.legacyKey = crypto.scryptSync(secret, 'salt', 32);
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: IV:AuthTag:Encrypted
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  decrypt(text: string): string {
    const textParts = text.split(':');

    // Handle Legacy CBC Format (IV:Encrypted)
    if (textParts.length === 2) {
      return this.decryptLegacy(textParts[0], textParts[1]);
    }

    if (textParts.length !== 3) {
       throw new Error('Invalid encryption format');
    }

    const iv = Buffer.from(textParts[0], 'hex');
    const authTag = Buffer.from(textParts[1], 'hex');
    const encryptedText = textParts[2]; // Hex string

    // Try the current key first, then fall back to the legacy-salt key for data encrypted
    // before L-13. GCM auth-tag verification makes the wrong-key attempt fail cleanly.
    try {
      return this.decryptWithKey(this.key, iv, authTag, encryptedText);
    } catch (e) {
      return this.decryptWithKey(this.legacyKey, iv, authTag, encryptedText);
    }
  }

  private decryptWithKey(key: Buffer, iv: Buffer, authTag: Buffer, encryptedText: string): string {
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private decryptLegacy(ivHex: string, encryptedHex: string): string {
      const iv = Buffer.from(ivHex, 'hex');
      // Try both keys for legacy CBC data as well.
      for (const key of [this.key, this.legacyKey]) {
        try {
          const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
          let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
          decrypted += decipher.final('utf8');
          return decrypted;
        } catch (e) {
          // try next key
        }
      }
      throw new Error('Failed to decrypt legacy data');
  }
}
