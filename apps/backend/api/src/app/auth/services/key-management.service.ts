import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

interface KeyEntry {
  kid: string;
  privateKey: string;
  publicKey: string;
}

@Injectable()
export class KeyManagementService implements OnModuleInit {
  private readonly logger = new Logger(KeyManagementService.name);
  private readonly keys = new Map<string, KeyEntry>();
  private activeKid!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const isProduction = process.env['NODE_ENV'] === 'production';
    const privateKeyPem = this.config.get<string>('RS_PRIVATE_KEY');
    const publicKeyPem = this.config.get<string>('RS_PUBLIC_KEY');
    const kid = this.config.get<string>('RS_KEY_ID', 'key-1');

    if (privateKeyPem && publicKeyPem) {
      this.keys.set(kid, { kid, privateKey: privateKeyPem, publicKey: publicKeyPem });
      this.activeKid = kid;
      this.logger.log(`RS256 key loaded from environment (kid=${kid})`);
      return;
    }

    if (isProduction) {
      throw new Error(
        'FATAL: RS_PRIVATE_KEY and RS_PUBLIC_KEY must be set in production for RS256 JWT signing.',
      );
    }

    // Development: generate ephemeral RSA-2048 key pair at startup.
    // This key is lost on restart — sessions are invalidated, which is acceptable in dev.
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const ephemeralKid = 'dev-ephemeral';
    this.keys.set(ephemeralKid, { kid: ephemeralKid, privateKey: privateKey as string, publicKey: publicKey as string });
    this.activeKid = ephemeralKid;
    this.logger.warn(
      'RS256 using ephemeral dev key (kid=dev-ephemeral). Set RS_PRIVATE_KEY / RS_PUBLIC_KEY for persistent keys.',
    );
  }

  getActiveKey(): { kid: string; privateKey: string } {
    const entry = this.keys.get(this.activeKid);
    if (!entry) throw new Error('No active signing key available');
    return { kid: entry.kid, privateKey: entry.privateKey };
  }

  getPublicKey(kid?: string): string | null {
    if (!kid) return this.keys.get(this.activeKid)?.publicKey ?? null;
    return this.keys.get(kid)?.publicKey ?? null;
  }
}
