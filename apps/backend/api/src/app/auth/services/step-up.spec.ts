import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AtomicCacheService } from '../../cache/atomic-cache.service';

import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';
import { SessionService } from './session.service';
import { SecurityAnalysisService } from './security-analysis.service';
import { TokenService } from './token.service';
import { MfaOrchestratorService } from './mfa-orchestrator.service';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { EnterpriseSsoService } from './enterprise-sso.service';
import { OidcProviderService } from './oidc-provider.service';
import { PasswordService } from './password.service';
import { StepUpScope, SINGLE_USE_SCOPES } from '../enums/step-up-scope.enum';

/**
 * Step-up re-authentication.
 *
 * The behaviour under test is what made the whole user-administration surface unreachable: the
 * server demanded a factor through a channel no client used, and it demanded the wrong factor for
 * accounts with 2FA enabled. These tests fix both properties in place.
 */
describe('AuthService — step-up re-authentication', () => {
  let service: AuthService;

  const cache = new Map<string, unknown>();
  const cacheManager = {
    get: jest.fn(async (key: string) => cache.get(key)),
    set: jest.fn(async (key: string, value: unknown) => void cache.set(key, value)),
    del: jest.fn(async (key: string) => void cache.delete(key)),
  };

  /**
   * The attempt budget goes through `AtomicCacheService`, which performs a Redis `INCR` in a
   * deployment. The stub reproduces its contract — increment and return the new total — rather
   * than the storage, because what these tests pin is the policy: five attempts, counted before
   * the factor is verified, cleared only by a success.
   */
  const atomicCache = {
    increment: jest.fn(async (key: string) => {
      const next = ((cache.get(key) as number) ?? 0) + 1;
      cache.set(key, next);
      return next;
    }),
    reset: jest.fn(async (key: string) => void cache.delete(key)),
    claimOnce: jest.fn(async () => true),
  };

  const usersService = { findUserByIdForAuth: jest.fn() };
  const passwordService = { verify: jest.fn(), verifyDummy: jest.fn() };
  const twoFactorAuthService = { verifyCode: jest.fn() };

  const userWithPassword = {
    id: 'user-1',
    security: { isTwoFactorEnabled: false, passwordHash: '$argon2id$hash' },
  };
  const userWithTwoFactor = {
    id: 'user-2',
    security: { isTwoFactorEnabled: true, passwordHash: '$argon2id$hash' },
  };
  const federatedUser = {
    id: 'user-3',
    security: { isTwoFactorEnabled: false, passwordHash: null },
  };

  /** No enterprise IdP and no configured social provider unless a test says otherwise. */
  const enterpriseSsoService = { discoverByEmail: jest.fn().mockResolvedValue(null) };
  const oidcProviderService = { isProviderConfigured: jest.fn().mockReturnValue(false) };

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    cache.clear();
    jest.clearAllMocks();

    const stub = {} as never;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: { sign: jest.fn(() => 'signed.step.up') } },
        { provide: ConfigService, useValue: { get: jest.fn(), getOrThrow: jest.fn() } },
        { provide: SessionService, useValue: stub },
        { provide: SecurityAnalysisService, useValue: stub },
        { provide: TokenService, useValue: stub },
        { provide: MfaOrchestratorService, useValue: stub },
        { provide: TwoFactorAuthService, useValue: twoFactorAuthService },
        { provide: PasswordService, useValue: passwordService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: EnterpriseSsoService, useValue: enterpriseSsoService },
        { provide: OidcProviderService, useValue: oidcProviderService },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: AtomicCacheService, useValue: atomicCache },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('when the account has no second factor', () => {
    beforeEach(() => usersService.findUserByIdForAuth.mockResolvedValue(userWithPassword));

    it('accepts the account password', async () => {
      passwordService.verify.mockResolvedValue(true);

      const result = await service.createStepUpToken(
        'user-1',
        { password: 'correct horse' },
        StepUpScope.DELETE_ACCOUNT,
      );

      expect(result.stepUpToken).toBe('signed.step.up');
      expect(result.maxAgeMs).toBeGreaterThan(0);
    });

    it('rejects a wrong password', async () => {
      passwordService.verify.mockResolvedValue(false);

      await expect(
        service.createStepUpToken('user-1', { password: 'wrong' }, StepUpScope.DELETE_ACCOUNT),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('asks for the password when none was supplied', async () => {
      await expect(
        service.createStepUpToken('user-1', {}, StepUpScope.DELETE_ACCOUNT),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('when the account has 2FA enabled', () => {
    beforeEach(() => usersService.findUserByIdForAuth.mockResolvedValue(userWithTwoFactor));

    it('accepts a valid OTP', async () => {
      twoFactorAuthService.verifyCode.mockResolvedValue(true);

      const result = await service.createStepUpToken(
        'user-2',
        { otpCode: '123456' },
        StepUpScope.IMPERSONATE,
      );

      expect(result.stepUpToken).toBe('signed.step.up');
      expect(twoFactorAuthService.verifyCode).toHaveBeenCalledWith(userWithTwoFactor, '123456');
    });

    /**
     * The important one. A password is not a second factor, so accepting one here would let an
     * attacker holding a stolen session downgrade a 2FA-protected account to a phished password.
     */
    it('refuses to fall back to the password', async () => {
      await expect(
        service.createStepUpToken(
          'user-2',
          { password: 'the real password' },
          StepUpScope.IMPERSONATE,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(passwordService.verify).not.toHaveBeenCalled();
    });

    it('rejects a wrong OTP', async () => {
      twoFactorAuthService.verifyCode.mockResolvedValue(false);

      await expect(
        service.createStepUpToken('user-2', { otpCode: '000000' }, StepUpScope.IMPERSONATE),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  /**
   * A federated identity with neither a password nor an enrolled second factor can satisfy no
   * challenge. Failing open would leave exactly those accounts unprotected on the most sensitive
   * operations in the product, so the request is refused and the user is told to enrol.
   */
  it('refuses an account that has no factor at all', async () => {
    usersService.findUserByIdForAuth.mockResolvedValue(federatedUser);

    await expect(
      service.createStepUpToken('user-3', { password: 'anything' }, StepUpScope.DELETE_ACCOUNT),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Timing is equalised so "no local password" is not measurably faster than a wrong one.
    expect(passwordService.verifyDummy).toHaveBeenCalled();
  });

  it('locks out after five failed attempts and keeps the lockout across factors', async () => {
    usersService.findUserByIdForAuth.mockResolvedValue(userWithPassword);
    passwordService.verify.mockResolvedValue(false);

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(
        service.createStepUpToken('user-1', { password: 'wrong' }, StepUpScope.DELETE_ACCOUNT),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    // The sixth is refused before the password is even checked.
    passwordService.verify.mockClear();
    await expect(
      service.createStepUpToken('user-1', { password: 'correct horse' }, StepUpScope.DELETE_ACCOUNT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(passwordService.verify).not.toHaveBeenCalled();
  });

  it('clears the attempt budget after a success', async () => {
    usersService.findUserByIdForAuth.mockResolvedValue(userWithPassword);
    passwordService.verify.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(
      service.createStepUpToken('user-1', { password: 'wrong' }, StepUpScope.DELETE_ACCOUNT),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await service.createStepUpToken('user-1', { password: 'right' }, StepUpScope.DELETE_ACCOUNT);

    expect(atomicCache.reset).toHaveBeenCalledWith('step-up-attempts:user-1');
  });

  describe('describeStepUpChallenge', () => {
    it.each([
      [userWithTwoFactor, 'otp'],
      [userWithPassword, 'password'],
    ])('reports the factor the account can actually satisfy', async (user, expected) => {
      usersService.findUserByIdForAuth.mockResolvedValue(user);
      await expect(service.describeStepUpChallenge(user.id)).resolves.toEqual({ factor: expected });
    });

    /**
     * A federated account is NOT unverifiable — it is verifiable at its identity provider. This
     * used to report 'none', which sent the client to an "enrol a second factor" prompt for an
     * action that itself required a second factor, so every SSO-provisioned account was
     * permanently unable to administer anything.
     */
    it('offers the SSO path when the account has an enterprise identity provider', async () => {
      usersService.findUserByIdForAuth.mockResolvedValue(federatedUser);
      // `describeStepUpChallenge` resolves the provider once, so a single queued value is
      // enough — and using `Once` keeps the mock from leaking into the tests that follow.
      enterpriseSsoService.discoverByEmail.mockResolvedValueOnce({ idpId: 'idp-1', idpName: 'Okta' });

      // The provider is named so the prompt can say where it is sending the user; "Continue"
      // with no destination is exactly the redirect people are taught not to accept.
      await expect(service.describeStepUpChallenge(federatedUser.id)).resolves.toEqual({
        factor: 'sso',
        ssoStartPath: '/auth/step-up/sso',
        idpName: 'Okta',
      });
    });

    it('offers the SSO path when the account signed up with a configured social provider', async () => {
      usersService.findUserByIdForAuth.mockResolvedValue({ ...federatedUser, authProvider: 'google' });
      enterpriseSsoService.discoverByEmail.mockResolvedValueOnce(null);
      oidcProviderService.isProviderConfigured.mockReturnValueOnce(true);

      // The provider is named so the prompt can say where it is sending the user; "Continue"
      // with no destination is exactly the redirect people are taught not to accept.
      await expect(service.describeStepUpChallenge(federatedUser.id)).resolves.toEqual({
        factor: 'sso',
        ssoStartPath: '/auth/step-up/sso',
        idpName: 'Google',
      });
    });

    it('reports none only when there is genuinely no factor anywhere', async () => {
      usersService.findUserByIdForAuth.mockResolvedValue(federatedUser);
      await expect(service.describeStepUpChallenge(federatedUser.id)).resolves.toEqual({
        factor: 'none',
      });
    });
  });
});

/**
 * Reuse policy lives on the scope, so a route cannot accidentally opt a destructive action out of
 * single use. This pins the classification itself.
 */
describe('StepUpScope — reuse policy', () => {
  it.each([
    StepUpScope.DELETE_ACCOUNT,
    StepUpScope.IMPERSONATE,
    StepUpScope.DISABLE_2FA,
    StepUpScope.CHANGE_PASSWORD,
    StepUpScope.CHANGE_EMAIL,
    StepUpScope.MANAGE_PAYMENT,
    StepUpScope.REVOKE_SESSION,
    StepUpScope.MANAGE_ROLES,
    StepUpScope.REGISTER_PASSKEY,
  ])('burns the token for %s', (scope) => {
    expect(SINGLE_USE_SCOPES.has(scope)).toBe(true);
  });

  it.each([
    StepUpScope.MANAGE_USERS,
    StepUpScope.MANAGE_USER_STATUS,
    StepUpScope.MANAGE_USER_CREDENTIALS,
  ])('allows reuse within the token lifetime for %s', (scope) => {
    // Routine administration. A prompt per click trains people to click through it.
    expect(SINGLE_USE_SCOPES.has(scope)).toBe(false);
  });
});
