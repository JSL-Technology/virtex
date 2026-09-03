
import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { Passkey } from '../../users/entities/passkey.entity';
import * as crypto from 'crypto';
import { UserIdentity } from '../interfaces/authenticated-user.interface';
import { BadRequestError, UnauthorizedError } from '../../i18n/localized.exception';

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);
  private rpName: string;
  private rpID: string;
  private origin: string;

  constructor(
    @InjectRepository(Passkey)
    private readonly passkeyRepository: Repository<Passkey>,
    // Never injected, yet `verifyAuthentication` called `this.userRepository.findOne(...)` — so
    // every passkey SIGN-IN threw `Cannot read properties of undefined (reading 'findOne')`.
    // The webpack build transpiles without type-checking, which is why it compiled for so long.
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {
    this.rpID = this.configService.get<string>('WEBAUTHN_RP_ID') || 'localhost';
    this.origin = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    this.rpName = this.configService.get<string>('APP_NAME') || 'Virtex';
  }

  async generateRegistrationOptions(user: UserIdentity) {
    const userPasskeys = await this.passkeyRepository.find({ where: { userId: user.id } });

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      // v13 takes the user handle as bytes, not as a string.
      userID: Uint8Array.from(Buffer.from(user.id, 'utf8')),
      userName: user.email,
      authenticatorSelection: {
        residentKey: 'preferred',
        // H13 FIX: 'required' enforces local device PIN/biometric verification (phishing-resistant).
        userVerification: 'required',
        authenticatorAttachment: 'platform',
      },
    });

    // Store challenge in cache
    await this.cacheManager.set(`webauthn_challenge_${user.id}`, options.challenge, 60000); // 1 minute TTL

    return options;
  }

  async verifyRegistration(user: UserIdentity, body: any) {
    const challenge = await this.cacheManager.get<string>(`webauthn_challenge_${user.id}`);
    if (!challenge) {
      throw new BadRequestError('AUTH.CHALLENGE_EXPIRED_OR_NOT_FOUND');
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
      });
    } catch (error) {
      this.logger.warn({ event: 'webauthn_registration_failed', reason: (error as Error).message }, 'WebAuthn registration error');
      throw new BadRequestError('AUTH.WEBAUTHN_REGISTRATION_FAILED');
    }

    if (verification.verified && verification.registrationInfo) {
      // @simplewebauthn/server v13 groups these under `registrationInfo.credential`; the previous
      // shape (`credentialPublicKey` / `credentialID` / `counter` at the top level) is from v10 and
      // is `undefined` against the installed version — so every passkey was stored with a null
      // credential id and could never be used to sign in again.
      const { id, publicKey, counter } = verification.registrationInfo.credential;

      const newPasskey = this.passkeyRepository.create({
        user: user as User,
        credentialID: id,
        publicKey: Buffer.from(publicKey).toString('base64'),
        counter,
        transports: body.response?.transports || [],
        webAuthnUserID: user.id
      });

      await this.passkeyRepository.save(newPasskey);
      await this.cacheManager.del(`webauthn_challenge_${user.id}`);

      return { verified: true };
    }

    throw new BadRequestError('AUTH.VERIFICATION_FAILED');
  }

  async generateAuthenticationOptions(_email?: string) {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: [],
      userVerification: 'required',
    });

    const challengeId = `auth_challenge_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
    await this.cacheManager.set(challengeId, { challenge: options.challenge }, 60000);

    return { ...options, challengeId };
  }

  async verifyAuthentication(body: any) {
    const { challengeId, credential } = body;
    const storedData = await this.cacheManager.get<{ challenge: string, userId?: string }>(challengeId);

    if (!storedData) {
      throw new BadRequestError('AUTH.CHALLENGE_EXPIRED_OR_INVALID');
    }

    const passkey = await this.passkeyRepository.findOne({
        where: { credentialID: credential.id },
        relations: ['user']
    });

    if (!passkey) {
      throw new UnauthorizedError('AUTH.PASSKEY_NOT_FOUND');
    }

    if (storedData.userId && storedData.userId !== passkey.userId) {
        throw new UnauthorizedError('AUTH.INVALID_USER_FOR_THIS_PASSKEY');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: storedData.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        // v13 renamed this parameter from `authenticator` to `credential` and renamed its fields.
        // Passing the old shape means the library receives no credential at all.
        credential: {
          id: passkey.credentialID,
          publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64')),
          counter: passkey.counter,
          // The stored strings are WebAuthn transport hints ('usb', 'nfc', 'internal', …); the
          // library types them as a closed union it does not export from this entry point.
          transports: passkey.transports as Parameters<typeof verifyAuthenticationResponse>[0]['credential']['transports'],
        },
      });
    } catch (error) {
      this.logger.warn({ event: 'webauthn_verification_failed', reason: (error as Error).message }, 'WebAuthn authentication error');
      throw new BadRequestError('AUTH.WEBAUTHN_VERIFICATION_FAILED');
    }

    if (verification.verified) {
      const { authenticationInfo } = verification;
      const { newCounter } = authenticationInfo;

      const freshUser = await this.userRepository.findOne({
        where: { id: passkey.userId },
        relations: ['roles', 'security'],
      });

      if (!freshUser || freshUser.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedError('AUTH.USUARIO_INACTIVO_BLOQUEADO');
      }

      passkey.counter = newCounter;
      await this.passkeyRepository.save(passkey);
      await this.cacheManager.del(challengeId);

      return { verified: true, user: freshUser };
    }

    throw new UnauthorizedError('AUTH.VERIFICATION_FAILED');
  }
}
