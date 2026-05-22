
import { Test, TestingModule } from '@nestjs/testing';
import { TwoFactorVerifiedGuard } from './two-factor-verified.guard';
import { TwoFactorAuthService } from '../services/two-factor-auth.service';
import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';

describe('TwoFactorVerifiedGuard', () => {
  let guard: TwoFactorVerifiedGuard;
  let twoFactorService: Partial<TwoFactorAuthService>;

  beforeEach(async () => {
    twoFactorService = {
      verifyCode: jest.fn(),
      isTwoFactorEnabled: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorVerifiedGuard,
        { provide: TwoFactorAuthService, useValue: twoFactorService },
      ],
    }).compile();

    guard = module.get<TwoFactorVerifiedGuard>(TwoFactorVerifiedGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw UnauthorizedException if user is not attached', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: null }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should return true if 2FA is NOT enabled for user', async () => {
    (twoFactorService.isTwoFactorEnabled as jest.Mock).mockResolvedValue(false);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
            user: { security: { isTwoFactorEnabled: false } },
            headers: {}
        }),
      }),
    } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('should throw ForbiddenException if 2FA is enabled but no header provided', async () => {
    (twoFactorService.isTwoFactorEnabled as jest.Mock).mockResolvedValue(true);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
            user: { security: { isTwoFactorEnabled: true } },
            headers: {}
        }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if 2FA is enabled and invalid code provided', async () => {
    (twoFactorService.isTwoFactorEnabled as jest.Mock).mockResolvedValue(true);
    (twoFactorService.verifyCode as jest.Mock).mockResolvedValue(false);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
            user: { security: { isTwoFactorEnabled: true } },
            headers: { 'x-otp-code': '123456' }
        }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should return true if 2FA is enabled and valid code provided', async () => {
    (twoFactorService.isTwoFactorEnabled as jest.Mock).mockResolvedValue(true);
    (twoFactorService.verifyCode as jest.Mock).mockResolvedValue(true);

    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
            user: { security: { isTwoFactorEnabled: true } },
            headers: { 'x-otp-code': '123456' }
        }),
      }),
    } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
