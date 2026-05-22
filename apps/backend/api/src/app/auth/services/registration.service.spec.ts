
import { Test, TestingModule } from '@nestjs/testing';
import { RegistrationService } from './registration.service';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { OrganizationsService } from '../../organizations/organizations.service';
import { MailService } from '../../mail/mail.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { ConflictException } from '@nestjs/common';
import { User } from '../../users/entities/user.entity/user.entity';
import { Role } from '../../roles/entities/role.entity';
import { RoleEnum } from '../../roles/enums/role.enum';
import { RegisterUserDto } from '../dto/register-user.dto';
import { GoogleRecaptchaValidator } from '@nestlab/google-recaptcha';
import { RegistrationStrategyFactory } from '../strategies/registration/registration-strategy.factory';
import { LocalizationService } from '../../localization/services/localization.service';

describe('RegistrationService', () => {
  let service: RegistrationService;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  const mockOrganizationsService = {
    create: jest.fn(),
  };

  const mockMailService = {
    sendDuplicateRegistrationEmail: jest.fn(),
  };

  const mockEventEmitter = {
    emitAsync: jest.fn(),
  };

  const mockOrganizationRepo = {
      findOne: jest.fn()
  };

  const mockRecaptchaValidator = {
      validate: jest.fn().mockResolvedValue({ success: true, errors: [] })
  };

  const mockStrategyFactory = {
      getStrategy: jest.fn().mockReturnValue({ validate: jest.fn().mockResolvedValue(true) })
  };

  const mockLocalizationService = {
      findById: jest.fn().mockResolvedValue({ countryCode: 'DO' })
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: OrganizationsService, useValue: mockOrganizationsService },
        { provide: MailService, useValue: mockMailService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: getRepositoryToken(Organization), useValue: mockOrganizationRepo },
        { provide: GoogleRecaptchaValidator, useValue: mockRecaptchaValidator },
        { provide: RegistrationStrategyFactory, useValue: mockStrategyFactory },
        { provide: LocalizationService, useValue: mockLocalizationService },
      ],
    }).compile();

    service = module.get<RegistrationService>(RegistrationService);
    dataSource = module.get<DataSource>(DataSource);
    queryRunner = dataSource.createQueryRunner();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto: RegisterUserDto = {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      password: 'Password123!',
      organizationName: 'Test Org',
      taxId: '123456789',
      fiscalRegionId: 'uuid-region',
      recaptchaToken: 'token',
      currency: 'USD'
    } as any;

    it('should throw ConflictException if taxId exists in the same fiscal region', async () => {
      // Mock User not found
      (mockQueryRunner.manager.findOne as jest.Mock).mockResolvedValueOnce(null);

      // Mock Organization found with same taxId AND fiscalRegionId
      (mockQueryRunner.manager.findOne as jest.Mock).mockResolvedValueOnce({ id: 'existing-org' });

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);

      expect(mockQueryRunner.manager.findOne).toHaveBeenNthCalledWith(2, Organization, {
        where: { taxId: '123456789', fiscalRegionId: 'uuid-region' }
      });
    });

    it('should NOT throw ConflictException if taxId exists but in different fiscal region', async () => {
       // This test logic is tricky because findOne returns the first match.
       // The service calls findOne({ where: { taxId, fiscalRegionId } }).
       // If I mock findOne to return NULL, it simulates "No organization found in this region with this taxId".

       // Mock User not found
       (mockQueryRunner.manager.findOne as jest.Mock).mockResolvedValueOnce(null);

       // Mock Organization NOT found in this region
       (mockQueryRunner.manager.findOne as jest.Mock).mockResolvedValueOnce(null);

       // Mock Org Creation
       mockOrganizationsService.create.mockResolvedValue({ id: 'new-org', legalName: 'Test Org' });

       // Mock Role creation/save
       (mockQueryRunner.manager.create as jest.Mock).mockImplementation((entity, dto) => dto);
       (mockQueryRunner.manager.save as jest.Mock).mockResolvedValue([]);

       await expect(service.register(registerDto)).resolves.not.toThrow();

       expect(mockQueryRunner.manager.findOne).toHaveBeenNthCalledWith(2, Organization, {
         where: { taxId: '123456789', fiscalRegionId: 'uuid-region' }
       });
    });
  });
});
