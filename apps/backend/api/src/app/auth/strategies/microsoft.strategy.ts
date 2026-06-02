
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-microsoft';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialUser } from '../interfaces/social-user.interface';

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(Strategy, 'microsoft') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.getOrThrow('MICROSOFT_CLIENT_ID'),
      clientSecret: configService.getOrThrow('MICROSOFT_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow('MICROSOFT_CALLBACK_URL'),
      scope: ['user.read', 'openid', 'email', 'profile'],
      state: true,
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: Function): Promise<any> {
    try {
        const emails: Array<{ value: string }> = profile.emails || [];
        const rawEmail: string = emails[0]?.value ?? profile.userPrincipalName ?? '';

        // M-02 / H-03: Whether Microsoft asserts the email is verified. AAD enterprise
        // accounts (presence of 'oid' — the Object ID — in the token claims) are IdP-managed
        // and always verified; personal MSA accounts must carry an explicit email_verified
        // claim. The flag is propagated to SocialAuthService, which enforces verification for
        // account-linking decisions (OWASP ASVS 2.1.5; OAuth 2.0 Security BCP; CWE-287).
        const json = (profile as any)._json ?? {};
        const emailVerified: boolean =
          json.email_verified === true ||
          json.verified_primary_email === true ||
          !!json.oid;
        const user: SocialUser = {
          email: rawEmail,
          firstName: profile.name?.givenName ?? '',
          lastName: profile.name?.familyName ?? '',
          picture: null,
          accessToken,
          provider: 'microsoft',
          providerId: profile.id,
          emailVerified,
        };
        done(null, user);
    } catch(err) {
        done(err, false);
    }
  }
}
