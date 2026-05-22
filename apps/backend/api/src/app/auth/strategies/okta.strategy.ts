
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

        const user: SocialUser = {
          email: emails[0].value,
          firstName: firstName,
          lastName: lastName,
          accessToken,
          provider: 'okta',
          providerId: id
        };
        done(null, user);
    } catch(err) {
        done(err, false);
    }
  }
}
