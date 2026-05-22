
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class CryptoUtil {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;
  // GCM standard IV is 12 bytes (96 bits)
  private readonly ivLength = 12;

  constructor(private configService: ConfigService) {
    const secret = this.configService.get<string>('ENCRYPTION_SECRET');
    if (!secret) {
      throw new Error('ENCRYPTION_SECRET is not defined in environment variables');
    }
    // Ensure key is 32 bytes for AES-256
    this.key = crypto.scryptSync(secret, 'salt', 32);
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

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private decryptLegacy(ivHex: string, encryptedHex: string): string {
      try {
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.key, iv);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      } catch (e) {
        throw new Error('Failed to decrypt legacy data');
      }
  }
}
