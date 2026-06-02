
import { Injectable, Inject, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
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
import { User } from '../../users/entities/user.entity/user.entity';
import { Passkey } from '../../users/entities/passkey.entity';
import * as crypto from 'crypto';

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);
  private rpName: string;
  private rpID: string;
  private origin: string;

  constructor(
    @InjectRepository(Passkey)
    private readonly passkeyRepository: Repository<Passkey>,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {
    this.rpID = this.configService.get<string>('WEBAUTHN_RP_ID') || 'localhost';
    this.origin = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    this.rpName = this.configService.get<string>('APP_NAME') || 'Virteex';
  }

  async generateRegistrationOptions(user: User) {
    const userPasskeys = await this.passkeyRepository.find({ where: { userId: user.id } });

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userID: user.id,
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

  async verifyRegistration(user: User, body: any) {
    const challenge = await this.cacheManager.get<string>(`webauthn_challenge_${user.id}`);
    if (!challenge) {
      throw new BadRequestException('Challenge expired or not found');
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
      throw new BadRequestException('WebAuthn registration failed');
    }

    if (verification.verified && verification.registrationInfo) {
      const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;

      const newPasskey = this.passkeyRepository.create({
        user,
        credentialID: credentialID,
        publicKey: Buffer.from(credentialPublicKey).toString('base64'),
        counter,
        transports: body.response.transports || [],
        webAuthnUserID: user.id
      });

      await this.passkeyRepository.save(newPasskey);
      await this.cacheManager.del(`webauthn_challenge_${user.id}`);

      return { verified: true };
    }

    throw new BadRequestException('Verification failed');
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
      throw new BadRequestException('Challenge expired or invalid');
    }

    const passkey = await this.passkeyRepository.findOne({
        where: { credentialID: credential.id },
        relations: ['user']
    });

    if (!passkey) {
      throw new UnauthorizedException('Passkey not found');
    }

    if (storedData.userId && storedData.userId !== passkey.userId) {
        throw new UnauthorizedException('Invalid user for this passkey');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: storedData.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        authenticator: {
          credentialPublicKey: Buffer.from(passkey.publicKey, 'base64'),
          credentialID: passkey.credentialID,
          counter: passkey.counter,
          transports: passkey.transports as any[],
        },
      });
    } catch (error) {
      this.logger.warn({ event: 'webauthn_verification_failed', reason: (error as Error).message }, 'WebAuthn authentication error');
      throw new BadRequestException('WebAuthn verification failed');
    }

    if (verification.verified) {
      const { authenticationInfo } = verification;
      const { newCounter } = authenticationInfo;

      passkey.counter = newCounter;
      await this.passkeyRepository.save(passkey);
      await this.cacheManager.del(challengeId);

      return { verified: true, user: passkey.user };
    }

    throw new UnauthorizedException('Verification failed');
  }
}
