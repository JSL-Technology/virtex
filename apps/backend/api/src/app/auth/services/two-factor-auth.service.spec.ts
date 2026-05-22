import { Test, TestingModule } from '@nestjs/testing';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity/user.entity';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { CryptoUtil } from '../../shared/utils/crypto.util';
import { UserCacheService } from '../modules/user-cache.service';
import { authenticator } from 'otplib';
import { ConfigService } from '@nestjs/config';

describe('TwoFactorAuthService', () => {
  let service: TwoFactorAuthService;
  let userSecurityRepo: any;
  let userRepo: any;
  let userCacheService: any;
  let cryptoUtil: any;
  let configService: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorAuthService,
        { provide: getRepositoryToken(UserSecurity), useValue: userSecurityRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: UserCacheService, useValue: userCacheService },
        { provide: CryptoUtil, useValue: cryptoUtil },
        { provide: ConfigService, useValue: configService }
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

          userSecurityRepo.save.mockImplementation(sec => Promise.resolve(sec));

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
           // Mock generate first to get codes
           // Or just mock verify
           const argon2 = require('argon2');
           jest.spyOn(argon2, 'verify').mockResolvedValue(true);

           user.security.backupCodes = ['hashed-code'];

           const result = await service.verifyBackupCode(user, 'plain-code');

           expect(result).toBe(true);
           expect(userSecurityRepo.save).toHaveBeenCalled();
           const savedSecurity = userSecurityRepo.save.mock.calls[0][0];
           expect(savedSecurity.backupCodes.length).toBe(0);
      });

       it('should return false if invalid', async () => {
           const user = { id: 'user-1', security: { isTwoFactorEnabled: true } } as User;
           const argon2 = require('argon2');
           jest.spyOn(argon2, 'verify').mockResolvedValue(false);

           user.security.backupCodes = ['hashed-code'];

           const result = await service.verifyBackupCode(user, 'wrong-code');

           expect(result).toBe(false);
           expect(userSecurityRepo.save).not.toHaveBeenCalled();
      });
  });
});
