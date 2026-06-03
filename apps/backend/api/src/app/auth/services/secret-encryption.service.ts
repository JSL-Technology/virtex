import { Injectable, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Reusable authenticated encryption (AES-256-GCM) for secrets stored at rest, such as
 * enterprise IdP client secrets. Keyed from ENCRYPTION_SECRET + AUTH_SALT (scrypt), mirroring
 * the IP-encryption scheme in TokenService for consistency. Output format: iv:ct:tag (hex).
 */
@Injectable()
export class SecretEncryptionService implements OnModuleInit {
  private key!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const secret = this.configService.get<string>('ENCRYPTION_SECRET');
    const salt = this.configService.get<string>('AUTH_SALT', 'secret-encryption-salt');
    if (!secret) {
      if (this.configService.get('NODE_ENV') === 'production') {
        throw new Error('FATAL: ENCRYPTION_SECRET is required to encrypt IdP secrets at rest.');
      }
      this.key = crypto.scryptSync('dev-secret-encryption', salt, 32);
      return;
    }
    this.key = crypto.scryptSync(secret, salt, 32);
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new InternalServerErrorException('Malformed encrypted secret.');
    }
    try {
      const iv = Buffer.from(parts[0], 'hex');
      const ct = Buffer.from(parts[1], 'hex');
      const tag = Buffer.from(parts[2], 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch {
      throw new InternalServerErrorException('Failed to decrypt stored secret.');
    }
  }
}
