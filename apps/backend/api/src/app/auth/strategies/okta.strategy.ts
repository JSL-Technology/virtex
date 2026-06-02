
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-okta-oauth';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialUser } from '../interfaces/social-user.interface';

@Injectable()
export class OktaStrategy extends PassportStrategy(Strategy, 'okta') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.getOrThrow('OKTA_CLIENT_ID'),
      clientSecret: configService.getOrThrow('OKTA_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow('OKTA_CALLBACK_URL'),
      audience: configService.getOrThrow('OKTA_DOMAIN'),
      scope: ['openid', 'email', 'profile'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: Function): Promise<any> {
    try {
        const { displayName, emails, id, name } = profile;
        const firstName = name ? name.givenName : displayName.split(' ')[0];
        const lastName = name ? name.familyName : displayName.split(' ').slice(1).join(' ');

        // M-02: Trust only the provider's explicit email_verified OIDC claim. For custom
        // OIDC/Okta tenants we must NOT assume verification, otherwise a malicious IdP could
        // assert an arbitrary email and hijack a local account.
        const json = (profile as any)._json ?? {};
        const emailVerified = json.email_verified === true || json.email_verified === 'true';

        const user: SocialUser = {
          email: emails[0].value,
          firstName: firstName,
          lastName: lastName,
          accessToken,
          provider: 'okta',
          providerId: id,
          emailVerified,
        };
        done(null, user);
    } catch(err) {
        done(err, false);
    }
  }
}
