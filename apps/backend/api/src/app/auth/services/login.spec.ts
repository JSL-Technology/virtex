import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UnauthorizedException } from '@nestjs/common';

import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';
import { SessionService } from './session.service';
import { SecurityAnalysisService } from './security-analysis.service';
import { TokenService } from './token.service';
import { MfaOrchestratorService } from './mfa-orchestrator.service';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { PasswordService } from './password.service';
import { EnterpriseSsoService } from './enterprise-sso.service';
import { OidcProviderService } from './oidc-provider.service';
import { AtomicCacheService } from '../../cache/atomic-cache.service';
import { UserStatus } from '../../users/entities/user.entity/user.entity';
import { AuthError } from '../enums/auth-error.enum';
import { AuthException } from '../exceptions/auth.exception';

/**
 * What `AuthService.login` actually promises.
 *
 * `auth.service.spec.ts` was 171 lines of dependency mocks and one assertion —
 * `expect(service).toBeDefined()` — on the single most security-critical method in the product.
 * Account enumeration, lockout ordering, the 2FA pending session and its device binding all lived
 * here with no test of any kind, while 458 lines of tests covered pure tax-id arithmetic.
 *
 * These are the properties a reviewer would otherwise have to re-derive from the code every time
 * it changes.
 */
describe('AuthService — sign in', () => {
  let service: AuthService;

  const cache = new Map<string, unknown>();
  const cacheManager = {
    get: jest.fn(async (key: string) => cache.get(key)),
    set: jest.fn(async (key: string, value: unknown) => void cache.set(key, value)),
    del: jest.fn(async (key: string) => void cache.delete(key)),
  };

  const usersService = {
    findUserForAuth: jest.fn(),
    findUserByIdForAuth: jest.fn(),
    save: jest.fn(),
  };
  const passwordService = {
    verify: jest.fn(),
    verifyDummy: jest.fn(),
    needsRehash: jest.fn().mockReturnValue(false),
    hash: jest.fn(),
  };
  const securityAnalysisService = {
    handleFailedLoginAttempt: jest.fn(),
    resetLoginAttempts: jest.fn(),
    checkImpossibleTravel: jest.fn(),
  };
  const tokenService = {
    generateAuthResponse: jest.fn().mockResolvedValue({
      user: { id: 'user-1', email: 'someone@example.com' },
      accessToken: 'access',
      refreshToken: 'refresh',
      refreshTokenId: 'rt-1',
    }),
  };
  const mfaOrchestratorService = { sendLoginOtp: jest.fn(), complete2faLogin: jest.fn() };
  const eventEmitter = { emit: jest.fn() };

  const activeUser = () => ({
    id: 'user-1',
    email: 'someone@example.com',
    status: UserStatus.ACTIVE,
    isPhoneVerified: false,
    phone: null,
    security: {
      passwordHash: '$argon2id$hash',
      isTwoFactorEnabled: false,
      tokenVersion: 3,
      lockoutUntil: null,
    },
  });

  beforeEach(async () => {
    cache.clear();
    jest.clearAllMocks();
    passwordService.needsRehash.mockReturnValue(false);

    const stub = {};
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: { sign: jest.fn(() => 'signed') } },
        { provide: ConfigService, useValue: { get: jest.fn(), getOrThrow: jest.fn() } },
        { provide: SessionService, useValue: stub },
        { provide: SecurityAnalysisService, useValue: securityAnalysisService },
        { provide: TokenService, useValue: tokenService },
        { provide: MfaOrchestratorService, useValue: mfaOrchestratorService },
        { provide: TwoFactorAuthService, useValue: { verifyCode: jest.fn() } },
        { provide: PasswordService, useValue: passwordService },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: EnterpriseSsoService, useValue: { discoverByEmail: jest.fn() } },
        { provide: OidcProviderService, useValue: { isProviderConfigured: jest.fn() } },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        {
          provide: AtomicCacheService,
          useValue: { increment: jest.fn(async () => 1), reset: jest.fn(), claimOnce: jest.fn(async () => true) },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    // The deliberate anti-timing delay would otherwise add half a second to every failing case.
    jest
      .spyOn(service as unknown as { simulateDelay: () => Promise<unknown> }, 'simulateDelay')
      .mockResolvedValue(undefined);
  });

  describe('account enumeration', () => {
    /**
     * The password is verified BEFORE any account-state check, and every rejection above that
     * line returns the same error. The previous order threw `USER_BLOCKED` for a locked account
     * and `USER_INACTIVE` for a disabled one before ever looking at the password, so anyone who
     * could POST an email address could map which addresses existed and which were locked.
     */
    it('answers an unknown address exactly as it answers a wrong password', async () => {
      usersService.findUserForAuth.mockResolvedValue(null);
      const unknown = await service
        .login({ email: 'nobody@example.com', password: 'whatever' } as never)
        .catch((e) => e);

      usersService.findUserForAuth.mockResolvedValue(activeUser());
      passwordService.verify.mockResolvedValue(false);
      const wrongPassword = await service
        .login({ email: 'someone@example.com', password: 'whatever' } as never)
        .catch((e) => e);

      expect(unknown).toBeInstanceOf(AuthException);
      expect(wrongPassword).toBeInstanceOf(AuthException);
      expect((unknown as AuthException).message).toBe((wrongPassword as AuthException).message);
      expect((unknown as AuthException).getStatus()).toBe(
        (wrongPassword as AuthException).getStatus(),
      );
    });

    it('pays the Argon2 cost even for an address that does not exist', async () => {
      usersService.findUserForAuth.mockResolvedValue(null);

      await service.login({ email: 'nobody@example.com', password: 'x' } as never).catch(() => undefined);

      // Without this, an unknown address returns in microseconds while a real one pays the full
      // hash cost — a difference large enough to enumerate accounts with a stopwatch.
      expect(passwordService.verifyDummy).toHaveBeenCalledWith('x');
    });

    it('does not record a failed attempt against an account that does not exist', async () => {
      usersService.findUserForAuth.mockResolvedValue(null);

      await service.login({ email: 'nobody@example.com', password: 'x' } as never).catch(() => undefined);

      expect(securityAnalysisService.handleFailedLoginAttempt).not.toHaveBeenCalled();
    });

    it('records a failed attempt against a real account', async () => {
      usersService.findUserForAuth.mockResolvedValue(activeUser());
      passwordService.verify.mockResolvedValue(false);

      await service
        .login({ email: 'someone@example.com', password: 'wrong' } as never)
        .catch(() => undefined);

      expect(securityAnalysisService.handleFailedLoginAttempt).toHaveBeenCalled();
    });
  });

  describe('account state, once the password is proven', () => {
    /**
     * Distinct states ARE reported — but only to a caller who has already demonstrated they hold
     * the password, at which point they learn nothing they did not already know.
     */
    it('reports a lockout only after the password checks out', async () => {
      const user = activeUser();
      user.security.lockoutUntil = new Date(Date.now() + 60_000) as never;
      usersService.findUserForAuth.mockResolvedValue(user);
      passwordService.verify.mockResolvedValue(true);

      await expect(
        service.login({ email: 'someone@example.com', password: 'right' } as never),
      ).rejects.toMatchObject({ message: expect.any(String) });

      const error = await service
        .login({ email: 'someone@example.com', password: 'right' } as never)
        .catch((e) => e);
      expect((error as AuthException).message).toContain(AuthError.USER_BLOCKED);
    });

    it('refuses a blocked account', async () => {
      const user = { ...activeUser(), status: UserStatus.BLOCKED };
      usersService.findUserForAuth.mockResolvedValue(user);
      passwordService.verify.mockResolvedValue(true);

      const error = await service
        .login({ email: 'someone@example.com', password: 'right' } as never)
        .catch((e) => e);
      expect((error as AuthException).message).toContain(AuthError.USER_BLOCKED);
    });

    it('refuses an invited account that has never set a password', async () => {
      const user = { ...activeUser(), status: UserStatus.PENDING };
      usersService.findUserForAuth.mockResolvedValue(user);
      passwordService.verify.mockResolvedValue(true);

      const error = await service
        .login({ email: 'someone@example.com', password: 'right' } as never)
        .catch((e) => e);
      expect((error as AuthException).message).toContain(AuthError.USER_INACTIVE);
    });
  });

  it('upgrades a password hash made with weaker parameters, transparently', async () => {
    const user = activeUser();
    usersService.findUserForAuth.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    passwordService.needsRehash.mockReturnValue(true);
    passwordService.hash.mockResolvedValue('$argon2id$stronger');

    await service.login({ email: 'someone@example.com', password: 'right' } as never);

    // Sign-in is the only moment the plaintext is legitimately in memory, so it is the only
    // opportunity to re-hash rows created under weaker settings.
    expect(passwordService.hash).toHaveBeenCalledWith('right');
    expect(usersService.save).toHaveBeenCalled();
  });

  it('never fails a legitimate sign-in because the hash upgrade failed', async () => {
    const user = activeUser();
    usersService.findUserForAuth.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue(true);
    passwordService.needsRehash.mockReturnValue(true);
    passwordService.hash.mockRejectedValue(new Error('argon2 unavailable'));

    await expect(
      service.login({ email: 'someone@example.com', password: 'right' } as never),
    ).resolves.toMatchObject({ accessToken: 'access' });
  });

  describe('the pending two-factor session', () => {
    const withTwoFactor = () => {
      const user = activeUser();
      user.security.isTwoFactorEnabled = true;
      return user;
    };

    it('issues a pending id instead of tokens, and never a token in the body', async () => {
      usersService.findUserForAuth.mockResolvedValue(withTwoFactor());
      passwordService.verify.mockResolvedValue(true);

      const result = await service.login({
        email: 'someone@example.com',
        password: 'right',
      } as never);

      expect(result).toMatchObject({ require2fa: true });
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
      expect((result as { pendingId: string }).pendingId).toEqual(expect.any(String));
    });

    /**
     * A mistyped digit must not destroy the pending session — it used to, which also made the
     * five-attempt counter it carried permanently unreachable.
     */
    it('survives a wrong code and counts the attempt', async () => {
      const user = withTwoFactor();
      usersService.findUserByIdForAuth.mockResolvedValue(user);
      const pendingId = await service.create2faPendingSession(user as never, '10.0.0.1', 'Firefox');

      await service.consume2faPendingSession(pendingId, '10.0.0.1', 'Firefox');
      await service.consume2faPendingSession(pendingId, '10.0.0.1', 'Firefox');

      expect(cache.get(`2fa_pending:${pendingId}`)).toMatchObject({ attempts: 2 });
    });

    it('gives up after five attempts', async () => {
      const user = withTwoFactor();
      usersService.findUserByIdForAuth.mockResolvedValue(user);
      const pendingId = await service.create2faPendingSession(user as never, '10.0.0.1', 'Firefox');

      for (let attempt = 0; attempt < 5; attempt++) {
        await service.consume2faPendingSession(pendingId, '10.0.0.1', 'Firefox');
      }

      await expect(
        service.consume2faPendingSession(pendingId, '10.0.0.1', 'Firefox'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(cache.get(`2fa_pending:${pendingId}`)).toBeUndefined();
    });

    it('refuses a pending id redeemed from another browser', async () => {
      const user = withTwoFactor();
      usersService.findUserByIdForAuth.mockResolvedValue(user);
      const pendingId = await service.create2faPendingSession(user as never, '10.0.0.1', 'Firefox');

      // Both halves of the binding are enforced. `uaHash` was stored and never compared, so half
      // the device binding did nothing and a stolen pendingId was redeemable anywhere.
      await expect(
        service.consume2faPendingSession(pendingId, '10.0.0.1', 'Chrome'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(cache.get(`2fa_pending:${pendingId}`)).toBeUndefined();
    });

    it('refuses a pending id redeemed from another address', async () => {
      const user = withTwoFactor();
      usersService.findUserByIdForAuth.mockResolvedValue(user);
      const pendingId = await service.create2faPendingSession(user as never, '10.0.0.1', 'Firefox');

      await expect(
        service.consume2faPendingSession(pendingId, '203.0.113.9', 'Firefox'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    /**
     * "Log out everywhere" and a password change both bump `tokenVersion`. A pending session
     * minted before that must not still be redeemable afterwards.
     */
    it('refuses a pending session that predates a global invalidation', async () => {
      const user = withTwoFactor();
      const pendingId = await service.create2faPendingSession(user as never, '10.0.0.1', 'Firefox');

      usersService.findUserByIdForAuth.mockResolvedValue({
        ...user,
        security: { ...user.security, tokenVersion: user.security.tokenVersion + 1 },
      });

      await expect(
        service.consume2faPendingSession(pendingId, '10.0.0.1', 'Firefox'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('is cleared once the second factor has actually been verified', async () => {
      const user = withTwoFactor();
      usersService.findUserByIdForAuth.mockResolvedValue(user);
      const pendingId = await service.create2faPendingSession(user as never, '10.0.0.1', 'Firefox');

      await service.clear2faPendingSession(pendingId);

      expect(cache.get(`2fa_pending:${pendingId}`)).toBeUndefined();
    });

    it('refuses an expired pending session', async () => {
      const user = withTwoFactor();
      usersService.findUserByIdForAuth.mockResolvedValue(user);
      const pendingId = await service.create2faPendingSession(user as never, '10.0.0.1', 'Firefox');

      const entry = cache.get(`2fa_pending:${pendingId}`) as { expiresAt: number };
      cache.set(`2fa_pending:${pendingId}`, { ...entry, expiresAt: Date.now() - 1 });

      await expect(
        service.consume2faPendingSession(pendingId, '10.0.0.1', 'Firefox'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
