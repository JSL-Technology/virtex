import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { AuthenticatedUser } from '../../security/principal';
import { SocketAuthenticatorPort } from '../../websockets/ports/socket-authenticator.port';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';
import { readAccessTokenCookie } from './access-token-cookie';
import { KeyManagementService } from './key-management.service';
import { UserIdentityService } from './user-identity.service';

type AccessTokenClaims = Pick<JwtPayload, 'id' | 'tokenVersion' | 'organizationId' | 'sessionId'>;

/**
 * Identity's answer to "who opened this socket" — the same rules as an HTTP request, end to end.
 *
 * The cookie is read by the function `JwtStrategy` uses (the unprefixed dev name is accepted only in
 * development), the token is verified as `JwtStrategy` verifies it (RS256, the key named by `kid`,
 * issuer and audience), and the principal comes from `UserIdentityService.resolveFromPayload`, which
 * checks the revocation denylist, the token version against the freshly loaded record, the status
 * allow-list and membership of the organization the token names.
 *
 * Every one of those used to be re-derived inside the gateway, and the copy drifted: HS256 against
 * JWT_SECRET (which can never verify the RS256 tokens the API issues), `security.tokenVersion` on a
 * projection that has no `security` object, and no membership check at all.
 */
@Injectable()
export class SocketAuthenticator extends SocketAuthenticatorPort {
  private readonly logger = new Logger(SocketAuthenticator.name);

  constructor(
    private readonly keyManagementService: KeyManagementService,
    private readonly userIdentityService: UserIdentityService,
  ) {
    super();
  }

  async authenticate(cookieHeader: string): Promise<AuthenticatedUser | null> {
    const token = readAccessTokenCookie(cookieHeader);
    if (!token) return null;

    const claims = this.verifyAccessToken(token);
    if (!claims) return null;

    return this.userIdentityService.resolveFromPayload({
      id: claims.id,
      tokenVersion: claims.tokenVersion,
      organizationId: claims.organizationId,
      sessionId: claims.sessionId,
    } as JwtPayload);
  }

  async revalidate(cookieHeader: string): Promise<boolean> {
    const token = readAccessTokenCookie(cookieHeader);
    if (!token) return false;

    // The signature, issuer and audience still have to verify: an expired token is still OUR
    // token, a forged one is nobody's. Only `exp` is waived — see the port.
    const claims = this.verifyAccessToken(token, { ignoreExpiration: true });
    if (!claims) return false;

    try {
      const principal = await this.userIdentityService.resolveFromPayload({
        id: claims.id,
        tokenVersion: claims.tokenVersion,
        organizationId: claims.organizationId,
        sessionId: claims.sessionId,
      } as JwtPayload);
      return Boolean(principal);
    } catch {
      return false;
    }
  }

  private verifyAccessToken(
    token: string,
    options: { ignoreExpiration?: boolean } = {},
  ): AccessTokenClaims | null {
    try {
      const kid = jwt.decode(token, { complete: true })?.header?.kid;
      const publicKey = this.keyManagementService.getPublicKey(kid);
      if (!publicKey) return null;

      return jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        issuer: 'virteex-api',
        audience: 'virteex-web',
        ignoreExpiration: options.ignoreExpiration ?? false,
      }) as AccessTokenClaims;
    } catch (e) {
      this.logger.debug(`WebSocket token verification failed: ${(e as Error).message}`);
      return null;
    }
  }
}
