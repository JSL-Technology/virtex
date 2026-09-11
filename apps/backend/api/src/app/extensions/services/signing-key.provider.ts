import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface SigningKeys {
  private: string;
  public: string;
}

/**
 * Supplies the RSA key pair the admission pipeline signs admitted extensions with, and the
 * sandbox verifies against before running them.
 *
 * The standalone `plugin-host` service fetched these from AWS Secrets Manager. That coupling is
 * dropped here in favour of the platform's own configuration surface, with the same production
 * guarantee: keys MUST be provided out-of-band in production, and are only ever generated
 * ephemerally when a developer explicitly opts in.
 *
 *  - `MARKETPLACE_SIGNING_KEYS`: JSON `{ "private": "<pem>", "public": "<pem>" }` (preferred).
 *  - `MARKETPLACE_SIGNING_PRIVATE_KEY` / `MARKETPLACE_SIGNING_PUBLIC_KEY`: PEM strings.
 *  - `ALLOW_EPHEMERAL_PLUGIN_KEYS=true`: generate a throwaway pair (never in production).
 */
@Injectable()
export class SigningKeyProvider {
  private readonly logger = new Logger(SigningKeyProvider.name);
  private readonly nodeEnv = process.env['NODE_ENV'] ?? 'development';
  private keys: SigningKeys | null = null;

  getKeys(): SigningKeys {
    if (this.keys) return this.keys;
    this.keys = this.resolveKeys();
    return this.keys;
  }

  getPublicKey(): string {
    return this.getKeys().public;
  }

  private resolveKeys(): SigningKeys {
    const bundle = process.env['MARKETPLACE_SIGNING_KEYS'];
    if (bundle) {
      try {
        const parsed = JSON.parse(bundle) as Partial<SigningKeys>;
        if (parsed.private && parsed.public) {
          return { private: parsed.private, public: parsed.public };
        }
      } catch {
        this.logger.error('MARKETPLACE_SIGNING_KEYS is set but is not valid JSON.');
      }
    }

    const priv = process.env['MARKETPLACE_SIGNING_PRIVATE_KEY'];
    const pub = process.env['MARKETPLACE_SIGNING_PUBLIC_KEY'];
    if (priv && pub) {
      return { private: priv, public: pub };
    }

    if (this.nodeEnv === 'production') {
      throw new Error(
        'Extension signing keys are mandatory in production. Set MARKETPLACE_SIGNING_KEYS.',
      );
    }

    if (process.env['ALLOW_EPHEMERAL_PLUGIN_KEYS'] === 'true') {
      this.logger.warn(
        'Generating ephemeral extension signing keys — for local development only. ' +
          'Extensions signed now will not verify after a restart.',
      );
      const generated = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      return { private: generated.privateKey, public: generated.publicKey };
    }

    throw new Error(
      'Extension signing keys are not configured. Set MARKETPLACE_SIGNING_KEYS, or ' +
        'ALLOW_EPHEMERAL_PLUGIN_KEYS=true for local development.',
    );
  }
}
