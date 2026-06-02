
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialUser } from '../interfaces/social-user.interface';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.getOrThrow('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile): Promise<SocialUser> {
    const { name, emails, photos } = profile;
    // M-02: Propagate Google's email_verified OIDC claim. Google reliably sets this for
    // verified Gmail/Workspace accounts.
    const json = (profile as any)._json ?? {};
    const emailVerified =
      json.email_verified === true ||
      json.email_verified === 'true' ||
      (emails && (emails[0] as any)?.verified === true);
    const user: SocialUser = {
      email: emails[0].value,
      firstName: name.givenName,
      lastName: name.familyName,
      picture: photos[0].value,
      accessToken,
      provider: 'google',
      providerId: profile.id,
      emailVerified: !!emailVerified,
    };
    return user;
  }
}
