import { Test, TestingModule } from '@nestjs/testing';
import { TwoFactorVerifiedGuard } from './two-factor-verified.guard';
import { TwoFactorAuthService } from '../services/two-factor-auth.service';
import { UserCacheService } from '../modules/user-cache.service';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';

/**
 * Note the deliberate behavioural change locked in by these tests: the guard no longer returns
 * true when 2FA is disabled.
 *
 * It used to short-circuit with `if (!isEnabled) return true`, which meant every sensitive
 * operation it protects (role changes, user deletion, status changes, session revocation,
 * impersonation) had NO re-authentication at all for the majority of users, since 2FA is opt-in.
 * A stolen session cookie was sufficient. The guard now always requires a second proof, falling
 * back to the account password when there is no second factor enrolled.
 */
describe('TwoFactorVerifiedGuard', () => {
  let guard: TwoFactorVerifiedGuard;
  let twoFactorService: Partial<TwoFactorAuthService>;
  let userCacheService: Partial<UserCacheService>;

  const contextFor = (user: unknown, headers: Record<string, string> = {}) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
    }) as never;

  beforeEach(async () => {
    twoFactorService = {
      verifyCode: jest.fn(),
      isTwoFactorEnabled: jest.fn(),
      verifyAccountPassword: jest.fn(),
      hasLocalPassword: jest.fn().mockResolvedValue(true),
    };

    userCacheService = {
      get: jest.fn().mockResolvedValue(0),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorVerifiedGuard,
        { provide: TwoFactorAuthService, useValue: twoFactorService },
        { provide: UserCacheService, useValue: userCacheService },
      ],
    }).compile();

    guard = module.get<TwoFactorVerifiedGuard>(TwoFactorVerifiedGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('throws UnauthorizedException if no user is attached', async () => {
    await expect(guard.canActivate(contextFor(null))).rejects.toThrow(UnauthorizedException);
  });

  describe('when 2FA is enabled', () => {
    beforeEach(() => {
      (twoFactorService.isTwoFactorEnabled as jest.Mock).mockResolvedValue(true);
    });

    it('rejects when no OTP header is provided', async () => {
      await expect(
        guard.canActivate(contextFor({ id: 'user-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an invalid code', async () => {
      (twoFactorService.verifyCode as jest.Mock).mockResolvedValue(false);
      await expect(
        guard.canActivate(contextFor({ id: 'user-1' }, { 'x-otp-code': '123456' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('accepts a valid code and clears the attempt budget', async () => {
      (twoFactorService.verifyCode as jest.Mock).mockResolvedValue(true);
      await expect(
        guard.canActivate(contextFor({ id: 'user-1' }, { 'x-otp-code': '123456' })),
      ).resolves.toBe(true);
      expect(userCacheService.del).toHaveBeenCalledWith('step-up-attempts:user-1');
    });
  });

  describe('when 2FA is NOT enabled', () => {
    beforeEach(() => {
      (twoFactorService.isTwoFactorEnabled as jest.Mock).mockResolvedValue(false);
    });

    it('does NOT pass through — it requires the password instead', async () => {
      // The core regression this guard exists to prevent.
      await expect(
        guard.canActivate(contextFor({ id: 'user-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an incorrect password', async () => {
      (twoFactorService.verifyAccountPassword as jest.Mock).mockResolvedValue(false);
      await expect(
        guard.canActivate(contextFor({ id: 'user-1' }, { 'x-reauth-password': 'wrong' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('accepts the correct password', async () => {
      (twoFactorService.verifyAccountPassword as jest.Mock).mockResolvedValue(true);
      await expect(
        guard.canActivate(contextFor({ id: 'user-1' }, { 'x-reauth-password': 'correct' })),
      ).resolves.toBe(true);
    });

    it('refuses federated accounts that have no password, rather than failing open', async () => {
      (twoFactorService.hasLocalPassword as jest.Mock).mockResolvedValue(false);
      await expect(
        guard.canActivate(contextFor({ id: 'user-1' }, { 'x-reauth-password': 'anything' })),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('enforces the attempt budget before verifying anything', async () => {
    (userCacheService.get as jest.Mock).mockResolvedValue(5); // budget exhausted
    (twoFactorService.isTwoFactorEnabled as jest.Mock).mockResolvedValue(true);
    (twoFactorService.verifyCode as jest.Mock).mockResolvedValue(true);

    await expect(
      guard.canActivate(contextFor({ id: 'user-1' }, { 'x-otp-code': '123456' })),
    ).rejects.toThrow(ForbiddenException);
    // A correct code must not be consulted once the budget is spent.
    expect(twoFactorService.verifyCode).not.toHaveBeenCalled();
  });
});
