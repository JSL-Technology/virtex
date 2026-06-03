import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response, Request } from 'express';
import * as crypto from 'crypto';

/**
 * The payload carried across the OAuth/OIDC redirect handshake. It never touches the
 * browser in readable form — it is encrypted (AES-256-GCM) and stored in a short-lived
 * httpOnly cookie. This keeps the flow fully stateless (no server session), so it scales
 * horizontally with no shared session store, matching the app's JWT architecture.
 */
export interface OauthTransaction {
  /** Provider/IdP key the handshake was started for (e.g. 'google', 'microsoft', or an IdP id). */
  flow: string;
  /** CSRF protection — echoed back by the IdP and compared on the callback. */
  state: string;
  /** Replay protection — bound to the id_token and compared after token validation. */
  nonce: string;
  /** PKCE code_verifier — proves the callback comes from the same client that started the flow. */
  codeVerifier: string;
  /** Optional org id for enterprise SSO flows (Phase 2). */
  orgId?: string;
  /** Issued-at (epoch ms) for TTL enforcement independent of the cookie maxAge. */
  iat: number;
}

const TX_TTL_MS = 5 * 60 * 1000; // 5 minutes — generous enough for the IdP round-trip.

@Injectable()
export class OauthStateService implements OnModuleInit {
  private key!: Buffer;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    // Fail fast: a dedicated secret for the handshake cookie keeps key separation from JWTs.
    const secret =
      this.configService.get<string>('OAUTH_STATE_SECRET') ||
      this.configService.get<string>('ENCRYPTION_SECRET');
    const salt = this.configService.get<string>('AUTH_SALT', 'oauth-state-salt');

    if (!secret) {
      if (this.configService.get('NODE_ENV') === 'production') {
        throw new Error('FATAL: OAUTH_STATE_SECRET (or ENCRYPTION_SECRET) is required in production.');
      }
      this.key = crypto.scryptSync('dev-oauth-state-secret', salt, 32);
      return;
    }
    this.key = crypto.scryptSync(secret, salt, 32);
  }

  private cookieName(): string {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    // __Host- prefix in production pins the cookie to the exact host with Secure + path=/,
    // but __Host- forbids a Path other than '/'. We need a scoped path, so use __Secure-.
    return isProduction ? '__Secure-oauth_tx' : 'oauth_tx';
  }

  /** Encrypt + authenticate the transaction into a compact token string. */
  private seal(tx: OauthTransaction): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(tx), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
  }

  /** Verify + decrypt a token string back into a transaction. Throws on any tampering. */
  private open(token: string): OauthTransaction {
    const parts = token.split('.');
    if (parts.length !== 3) throw new BadRequestException('Invalid OAuth state.');
    try {
      const iv = Buffer.from(parts[0], 'base64url');
      const ciphertext = Buffer.from(parts[1], 'base64url');
      const tag = Buffer.from(parts[2], 'base64url');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8')) as OauthTransaction;
    } catch {
      // GCM auth failure (tampered cookie) or malformed payload — fail closed.
      throw new BadRequestException('Invalid or tampered OAuth state.');
    }
  }

  /** Create a fresh transaction with new state/nonce/PKCE values. */
  createTransaction(flow: string, orgId?: string): OauthTransaction {
    return {
      flow,
      orgId,
      state: crypto.randomBytes(32).toString('base64url'),
      nonce: crypto.randomBytes(32).toString('base64url'),
      // RFC 7636: code_verifier is 43-128 chars of unreserved characters; 32 random bytes → 43 chars.
      codeVerifier: crypto.randomBytes(32).toString('base64url'),
      iat: Date.now(),
    };
  }

  /** PKCE S256 challenge derived from the verifier. */
  codeChallengeS256(codeVerifier: string): string {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }

  /** Persist the transaction in the encrypted httpOnly cookie. */
  setTransactionCookie(res: Response, tx: OauthTransaction): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    res.cookie(this.cookieName(), this.seal(tx), {
      httpOnly: true,
      secure: isProduction,
      // 'lax' is required: the IdP redirects back via a top-level GET, and 'strict' would
      // drop the cookie on that cross-site navigation, breaking the handshake.
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: TX_TTL_MS,
    });
  }

  /** Read + validate the transaction from the request, enforcing TTL. Does not clear it. */
  readTransaction(req: Request): OauthTransaction {
    const raw = req.cookies?.[this.cookieName()] || req.cookies?.['oauth_tx'] || req.cookies?.['__Secure-oauth_tx'];
    if (!raw) throw new BadRequestException('Missing OAuth state — please restart the sign-in.');
    const tx = this.open(raw);
    if (!tx.iat || Date.now() - tx.iat > TX_TTL_MS) {
      throw new BadRequestException('OAuth state expired — please restart the sign-in.');
    }
    return tx;
  }

  /** Remove the transaction cookie after the handshake completes (success or failure). */
  clearTransactionCookie(res: Response): void {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    res.clearCookie('__Secure-oauth_tx', { path: '/api/v1/auth', secure: true });
    res.clearCookie('oauth_tx', { path: '/api/v1/auth', secure: isProduction });
  }

  /**
   * Constant-time comparison of the state returned by the IdP against the stored state.
   * Prevents login CSRF (OAuth 2.0 Security BCP §4.7; CWE-352).
   */
  verifyState(expected: string, actual: unknown): void {
    if (typeof actual !== 'string' || actual.length === 0) {
      throw new BadRequestException('Missing OAuth state parameter.');
    }
    const a = Buffer.from(expected);
    const b = Buffer.from(actual);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new BadRequestException('OAuth state mismatch — possible CSRF.');
    }
  }
}
