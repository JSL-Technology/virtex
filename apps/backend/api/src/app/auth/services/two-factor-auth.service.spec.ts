import { Test, TestingModule } from '@nestjs/testing';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity/user.entity';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { CryptoUtil } from '../../shared/utils/crypto.util';
import { UserCacheService } from '../modules/user-cache.service';
import { PasswordService } from './password.service';
import { authenticator } from 'otplib';
import { ConfigService } from '@nestjs/config';

describe('TwoFactorAuthService', () => {
  let service: TwoFactorAuthService;
  let userSecurityRepo: any;
  let userRepo: any;
  let userCacheService: any;
  let cryptoUtil: any;
  let configService: any;
  let passwordService: any;

  beforeEach(async () => {
    userSecurityRepo = {
      save: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
          insert: jest.fn().mockReturnThis(),
          into: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          orIgnore: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({})
      })),
      findOne: jest.fn()
    };
    userRepo = {
        findOne: jest.fn()
    };
    userCacheService = {
        clearUserSession: jest.fn()
    };
    cryptoUtil = {
        encrypt: jest.fn(val => `encrypted-${val}`),
        decrypt: jest.fn(val => val.replace('encrypted-', ''))
    };
    configService = {
        get: jest.fn(key => 'App')
    };
    passwordService = {
        hash: jest.fn(val => Promise.resolve(`hashed-${val}`)),
        verify: jest.fn((plain, hashed) => Promise.resolve(hashed === `hashed-${plain}`))
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorAuthService,
        { provide: getRepositoryToken(UserSecurity), useValue: userSecurityRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: UserCacheService, useValue: userCacheService },
        { provide: CryptoUtil, useValue: cryptoUtil },
        { provide: ConfigService, useValue: configService },
        { provide: PasswordService, useValue: passwordService }
      ],
    }).compile();

    service = module.get<TwoFactorAuthService>(TwoFactorAuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateBackupCodes', () => {
      it('should generate 10 hashed backup codes', async () => {
          const user = { id: 'user-1', email: 'test@test.com', security: { isTwoFactorEnabled: true } } as User;

          userSecurityRepo.save.mockImplementation((sec: unknown) => Promise.resolve(sec));
          passwordService.hash.mockImplementation((val: string) => Promise.resolve(`hashed-${val}`));

          const result = await service.generateBackupCodes(user);

          expect(result.codes.length).toBe(10);
          expect(userSecurityRepo.save).toHaveBeenCalled();
          const savedSecurity = userSecurityRepo.save.mock.calls[0][0];
          expect(savedSecurity.backupCodes.length).toBe(10);
      });
  });

  describe('verifyBackupCode', () => {
      it('should return true and remove code if valid', async () => {
           const user = { id: 'user-1', security: { isTwoFactorEnabled: true } } as User;

           passwordService.verify.mockResolvedValue(true);

           user.security.backupCodes = ['hashed-code'];

           const result = await service.verifyBackupCode(user, 'plain-code');

           expect(result).toBe(true);
           expect(userSecurityRepo.save).toHaveBeenCalled();
           const savedSecurity = userSecurityRepo.save.mock.calls[0][0];
           expect(savedSecurity.backupCodes.length).toBe(0);
      });

       it('should return false if invalid', async () => {
           const user = { id: 'user-1', security: { isTwoFactorEnabled: true } } as User;
           passwordService.verify.mockResolvedValue(false);

           user.security.backupCodes = ['hashed-code'];

           const result = await service.verifyBackupCode(user, 'wrong-code');

           expect(result).toBe(false);
           expect(userSecurityRepo.save).not.toHaveBeenCalled();
      });
  });

  /**
   * Enabling 2FA was unreachable from the product for every account, and no test caught it:
   * the service was exercised with a valid password while the settings screen sent an empty
   * string, which the DTO's `@IsNotEmpty()` rejected with 400 before the service ran.
   *
   * These tests pin the contract that replaces it — the code, and nothing else — and assert
   * that the path a federated identity takes (no `passwordHash` at all) now succeeds.
   */
  describe('enableTwoFactor', () => {
      const stagedSecret = authenticator.generateSecret();

      const userWith = (security: Record<string, unknown>) => {
          userRepo.findOne.mockResolvedValue({
              id: 'user-1',
              email: 'test@test.com',
              security: { pendingTwoFactorSecret: `encrypted-${stagedSecret}`, ...security },
          });
          userSecurityRepo.save.mockImplementation((sec: unknown) => Promise.resolve(sec));
      };

      it('enables 2FA from the code alone — no password argument exists', async () => {
          userWith({ passwordHash: 'hashed-whatever' });

          const result = await service.enableTwoFactor(
              { id: 'user-1' } as User,
              authenticator.generate(stagedSecret),
          );

          expect(result.backupCodes.length).toBe(10);
          const saved = userSecurityRepo.save.mock.calls[0][0];
          expect(saved.isTwoFactorEnabled).toBe(true);
          expect(saved.twoFactorSecret).toBe(`encrypted-${stagedSecret}`);
          expect(saved.pendingTwoFactorSecret).toBeNull();
          // The whole defect: this method must never consult a password again.
          expect(passwordService.verify).not.toHaveBeenCalled();
      });

      it('enables 2FA for a federated account that has no local password', async () => {
          userWith({ passwordHash: null });

          const result = await service.enableTwoFactor(
              { id: 'user-1' } as User,
              authenticator.generate(stagedSecret),
          );

          expect(result.backupCodes.length).toBe(10);
          expect(userSecurityRepo.save.mock.calls[0][0].isTwoFactorEnabled).toBe(true);
      });

      it('still refuses a wrong code', async () => {
          userWith({ passwordHash: 'hashed-whatever' });

          await expect(
              service.enableTwoFactor({ id: 'user-1' } as User, '000000'),
          ).rejects.toThrow('Invalid 2FA token');
          expect(userSecurityRepo.save).not.toHaveBeenCalled();
      });

      it('refuses when no secret was staged first', async () => {
          userRepo.findOne.mockResolvedValue({ id: 'user-1', security: { pendingTwoFactorSecret: null } });

          await expect(
              service.enableTwoFactor({ id: 'user-1' } as User, '123456'),
          ).rejects.toThrow('2FA configuration not initiated. Please generate secret first.');
      });
  });

  /**
   * The DTO is the contract the client codes against. It carrying a required field the client
   * cannot fill is what broke the feature, so the shape itself is asserted here.
   */
  describe('EnableTwoFactorDto', () => {
      it('requires the code and nothing else', async () => {
          const { validate } = await import('class-validator');
          const { plainToInstance } = await import('class-transformer');
          const { EnableTwoFactorDto } = await import('../dto/enable-2fa.dto');

          const ok = plainToInstance(EnableTwoFactorDto, { token: '123456' });
          expect(await validate(ok)).toHaveLength(0);

          expect(Object.prototype.hasOwnProperty.call(new EnableTwoFactorDto(), 'currentPassword')).toBe(false);
      });
  });
});
