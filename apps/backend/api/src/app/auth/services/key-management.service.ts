import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { isDevLikeEnvironment } from '../auth.config';

interface KeyEntry {
  kid: string;
  /** Absent for retired keys, which may verify but must never sign. */
  privateKey?: string;
  publicKey: string;
}

/**
 * RS256 signing key ring with real rotation support.
 *
 * ## Why this changed
 *
 * The previous implementation held a `Map` and advertised rotation via the `kid` header, but
 * only ever loaded ONE key into it. Rotation was therefore impossible in practice: replacing
 * RS_PRIVATE_KEY invalidated every access token in flight, because the public key needed to
 * verify them no longer existed anywhere. The capability the `kid` claim exists to enable was
 * never actually built.
 *
 * The ring now separates *signing* from *verifying*:
 *   - exactly one active key signs;
 *   - any number of retired keys can still verify.
 *
 * A rotation is consequently zero-downtime:
 *   1. deploy with the new key as RS_PRIVATE_KEY/RS_PUBLIC_KEY/RS_KEY_ID, and the previous
 *      public key listed in RS_RETIRED_PUBLIC_KEYS;
 *   2. once the longest access-token lifetime has elapsed, drop the retired entry.
 *
 * RS_RETIRED_PUBLIC_KEYS is a JSON object of kid -> PEM.
 */
@Injectable()
export class KeyManagementService implements OnModuleInit {
  private readonly logger = new Logger(KeyManagementService.name);
  private readonly keys = new Map<string, KeyEntry>();
  private activeKid!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const privateKeyPem = this.normalizePem(this.config.get<string>('RS_PRIVATE_KEY'));
    const publicKeyPem = this.normalizePem(this.config.get<string>('RS_PUBLIC_KEY'));
    const kid = this.config.get<string>('RS_KEY_ID', 'key-1');

    if (privateKeyPem && publicKeyPem) {
      this.assertKeyPairMatches(privateKeyPem, publicKeyPem, kid);
      this.keys.set(kid, { kid, privateKey: privateKeyPem, publicKey: publicKeyPem });
      this.activeKid = kid;
      this.loadRetiredKeys();
      this.logger.log(
        `RS256 key ring loaded (active kid=${kid}, ${this.keys.size - 1} retired verification key(s))`,
      );
      return;
    }

    if (!isDevLikeEnvironment()) {
      throw new Error(
        'FATAL: RS_PRIVATE_KEY and RS_PUBLIC_KEY must be set outside development/test for RS256 JWT signing.',
      );
    }

    // Development only: an ephemeral pair, regenerated on every boot. Restarting invalidates
    // sessions, which is acceptable locally. It is NOT acceptable in any deployed environment —
    // with more than one replica each would sign with a different key and reject the others'
    // tokens — hence the hard failure above.
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const ephemeralKid = 'dev-ephemeral';
    this.keys.set(ephemeralKid, {
      kid: ephemeralKid,
      privateKey: privateKey as string,
      publicKey: publicKey as string,
    });
    this.activeKid = ephemeralKid;
    this.logger.warn(
      'RS256 using an ephemeral development key (kid=dev-ephemeral). Set RS_PRIVATE_KEY / RS_PUBLIC_KEY for persistent keys.',
    );
  }

  /** PEM values in environment variables usually arrive with escaped newlines. */
  private normalizePem(value?: string): string | undefined {
    if (!value) return undefined;
    const pem = value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
    return pem.trim();
  }

  /**
   * Refuse to start on a mismatched pair. Left undetected, every token would be signed with one
   * key and verified against another, so all authentication would fail at runtime with an opaque
   * error — far more expensive to diagnose than refusing to boot.
   */
  private assertKeyPairMatches(privateKeyPem: string, publicKeyPem: string, kid: string): void {
    try {
      const probe = Buffer.from('virteex-key-selfcheck');
      const signature = crypto.sign('sha256', probe, privateKeyPem);
      if (!crypto.verify('sha256', probe, publicKeyPem, signature)) {
        throw new Error('signature did not verify');
      }
    } catch (error) {
      throw new Error(
        `FATAL: RS_PRIVATE_KEY and RS_PUBLIC_KEY (kid=${kid}) are not a matching key pair: ${(error as Error).message}`,
      );
    }
  }

  private loadRetiredKeys(): void {
    const raw = this.config.get<string>('RS_RETIRED_PUBLIC_KEYS');
    if (!raw?.trim()) return;

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `FATAL: RS_RETIRED_PUBLIC_KEYS is not valid JSON (expected {"kid":"PEM"}): ${(error as Error).message}`,
      );
    }

    for (const [kid, pem] of Object.entries(parsed)) {
      const publicKey = this.normalizePem(pem);
      if (!publicKey) continue;
      if (this.keys.has(kid)) {
        this.logger.warn(`Retired key "${kid}" duplicates the active kid; ignoring the retired entry.`);
        continue;
      }
      // No privateKey: retired keys verify old tokens and can never be selected for signing.
      this.keys.set(kid, { kid, publicKey });
    }
  }

  getActiveKey(): { kid: string; privateKey: string } {
    const entry = this.keys.get(this.activeKid);
    if (!entry?.privateKey) throw new Error('No active signing key available');
    return { kid: entry.kid, privateKey: entry.privateKey };
  }

  getPublicKey(kid?: string): string | null {
    if (!kid) return this.keys.get(this.activeKid)?.publicKey ?? null;
    return this.keys.get(kid)?.publicKey ?? null;
  }

  /**
   * JWKS document (RFC 7517) covering every key that can currently verify a token.
   *
   * Published so other services in the platform — and any future resource server — can validate
   * access tokens without the private key being shared around, and so key rotation propagates
   * automatically instead of requiring a coordinated redeploy.
   */
  getJwks(): { keys: Array<Record<string, string>> } {
    const keys = [...this.keys.values()].map((entry) => {
      const jwk = crypto.createPublicKey(entry.publicKey).export({ format: 'jwk' }) as {
        n: string;
        e: string;
      };
      return {
        kty: 'RSA',
        use: 'sig',
        alg: 'RS256',
        kid: entry.kid,
        n: jwk.n,
        e: jwk.e,
      };
    });
    return { keys };
  }
}
