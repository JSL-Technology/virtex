
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-microsoft';
import { Injectable, UnauthorizedException } from '@nestjs/common';
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

        // H-03 FIX: Require verified email before accepting the identity.
        // Microsoft AAD enterprise accounts always have a verified email (indicated by the
        // presence of 'oid' — the Object ID — in the token claims). Personal Microsoft
        // accounts that don't carry 'oid' must explicitly pass 'email_verified'.
        // This prevents account-takeover via unverified Microsoft personal accounts
        // (OWASP ASVS 2.1.5; OAuth 2.0 Security BCP; CWE-287).
        const emailVerified: boolean =
          profile._json?.email_verified === true ||
          profile._json?.verified_primary_email === true ||
          !!profile._json?.oid; // OID presence indicates AAD (IdP-managed, always verified)

        if (!rawEmail || !emailVerified) {
          return done(new UnauthorizedException('Microsoft account email is not verified'), false);
        }

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
