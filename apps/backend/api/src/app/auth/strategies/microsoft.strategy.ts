
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
      scope: ['user.read'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: Function): Promise<any> {
    try {
        const { name, emails, id } = profile;
        const user: SocialUser = {
          email: emails && emails.length > 0 ? emails[0].value : profile.userPrincipalName, // Microsoft sometimes uses userPrincipalName
          firstName: name ? name.givenName : '',
          lastName: name ? name.familyName : '',
          picture: null, // Need specific graph call for photo, skipping for now
          accessToken,
          provider: 'microsoft',
          providerId: id
        };
        done(null, user);
    } catch(err) {
        done(err, false);
    }
  }
}
