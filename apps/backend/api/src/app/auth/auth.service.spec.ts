
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { VerificationCode } from './entities/verification-code.entity';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { AuditTrailService } from '../audit/audit.service';
import { UserCacheService } from './modules/user-cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CryptoUtil } from '../shared/utils/crypto.util';
import { OrganizationsService } from '../organizations/organizations.service';
import { RegistrationService } from './services/registration.service';
import { GeoService } from '../geo/geo.service';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { ImpersonationService } from './services/impersonation.service';
import { UsersService } from '../users/users.service';
import { SessionService } from './services/session.service';
import { SecurityAnalysisService } from './services/security-analysis.service';
import { TokenService } from './services/token.service';
import { SocialAuthService } from './services/social-auth.service';
import { MfaOrchestratorService } from './services/mfa-orchestrator.service';
import { PasswordService } from './services/password.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
        }
    }),
  };

  const mockUserCacheService = {
      clearUserSession: jest.fn(),
      invalidate: jest.fn(),
  };

  const mockRegistrationService = {
      register: jest.fn(),
  }

  const mockGeoService = {
      getLocation: jest.fn(),
  }

  const mockUsersService = {
      findUserForAuth: jest.fn(),
      findUserByIdForAuth: jest.fn(),
      findOneByEmail: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
  }

  const mockSocialAuthService = {
      validateOAuthLogin: jest.fn(),
      generateRegisterToken: jest.fn(),
      getSocialRegisterInfo: jest.fn(),
  }

  const mockMfaOrchestratorService = {
      sendPhoneOtp: jest.fn(),
      verifyPhoneOtp: jest.fn(),
      sendLoginOtp: jest.fn(),
      complete2faLogin: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: getRepositoryToken(User), useValue: mockRepository },
        { provide: getRepositoryToken(Organization), useValue: mockRepository },
        { provide: getRepositoryToken(RefreshToken), useValue: mockRepository },
        { provide: getRepositoryToken(VerificationCode), useValue: mockRepository },
        { provide: 'SmsProvider', useValue: { send: jest.fn() } },
        { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(), getOrThrow: jest.fn() } },
        { provide: DataSource, useValue: mockDataSource },
        { provide: MailService, useValue: { sendDuplicateRegistrationEmail: jest.fn() } },
        { provide: AuditTrailService, useValue: { record: jest.fn() } },
        { provide: UserCacheService, useValue: mockUserCacheService },
        { provide: EventEmitter2, useValue: { emitAsync: jest.fn() } },
        { provide: CryptoUtil, useValue: { decrypt: jest.fn(), encrypt: jest.fn() } },
        { provide: OrganizationsService, useValue: { create: jest.fn() } },
        { provide: RegistrationService, useValue: mockRegistrationService },
        { provide: GeoService, useValue: mockGeoService },
        {
          provide: PasswordRecoveryService,
          useValue: {
            setPasswordFromInvitation: jest.fn(),
          },
        },
        {
          provide: ImpersonationService,
          useValue: {
            validateImpersonationRequest: jest.fn(),
            validateStopImpersonation: jest.fn(),
          },
        },
        {
          provide: SessionService,
          useValue: {
            refreshAccessToken: jest.fn(),
            getUserSessions: jest.fn(),
            revokeSession: jest.fn(),
            verifyUserFromToken: jest.fn(),
          },
        },
        {
          provide: SecurityAnalysisService,
          useValue: {
            checkImpossibleTravel: jest.fn(),
            validateTwoFactorCode: jest.fn(),
          },
        },
        {
          provide: TokenService,
          useValue: {
            generateAuthResponse: jest.fn(),
            buildSafeUser: jest.fn(),
            buildPayload: jest.fn(),
          },
        },
        { provide: SocialAuthService, useValue: mockSocialAuthService },
        { provide: MfaOrchestratorService, useValue: mockMfaOrchestratorService },
        { provide: PasswordService, useValue: { verify: jest.fn(), verifyDummy: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
