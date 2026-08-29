import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

import { KeyManagementService } from '../../services/key-management.service';
import { UserIdentityService } from '../../services/user-identity.service';
import { JwtPayload } from '../../interfaces/jwt-payload.interface';
import { AuthenticatedUser } from '../../interfaces/authenticated-user.interface';
import { isDevLikeEnvironment } from '../../auth.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    keyManagementService: KeyManagementService,
    private readonly userIdentityService: UserIdentityService,
  ) {
    super({
      // H1: cookie-only extraction. `ExtractJwt.fromAuthHeaderAsBearerToken()` was removed —
      // access tokens travel exclusively in httpOnly cookies and are never returned in a response
      // body, so also accepting an Authorization header only widened the attack surface: any
      // accidental leak of the JWT into JS, logs or a third party would be directly replayable.
      // Machine-to-machine callers must use a dedicated strategy with their own audience/scopes.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request | undefined) => {
          const cookies = req?.cookies ?? {};
          // The unprefixed name only exists in local plain-HTTP development, where browsers
          // reject the Secure attribute that __Host- requires.
          return (
            cookies['__Host-access_token'] ??
            (isDevLikeEnvironment() ? cookies['access_token'] : null) ??
            null
          );
        },
      ]),
      ignoreExpiration: false,
      // H-05: RS256 with a `kid` header so the signing key can be rotated without invalidating
      // every live session. The public key is resolved per-token from the key ring
      // (RFC 7515 §4.1.4; NIST SP 800-57).
      secretOrKeyProvider: (
        _req: Request,
        rawJwt: string,
        done: (err: Error | null, key?: unknown) => void,
      ) => {
        try {
          const parts = rawJwt.split('.');
          if (parts.length !== 3) {
            return done(new UnauthorizedException('Malformed JWT'), undefined);
          }
          const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
          // `alg` is additionally pinned by the `algorithms` option below, so a token claiming
          // `none` or an HMAC algorithm is rejected by passport-jwt regardless of this lookup.
          const publicKey = keyManagementService.getPublicKey(
            typeof header?.kid === 'string' ? header.kid : undefined,
          );
          if (!publicKey) {
            return done(new UnauthorizedException('Unknown key ID'), undefined);
          }
          done(null, publicKey);
        } catch {
          done(new UnauthorizedException('JWT key resolution failed'), undefined);
        }
      },
      algorithms: ['RS256'],
      issuer: 'virteex-api',
      audience: 'virteex-web',
    });
  }

  /**
   * A-3: all identity/authorisation logic lives in UserIdentityService so this strategy and
   * TokenService cannot drift apart again. The strategy's only job is token extraction and
   * signature verification.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    return this.userIdentityService.resolveFromPayload(payload);
  }
}
