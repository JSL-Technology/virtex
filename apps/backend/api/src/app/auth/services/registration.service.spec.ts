
import { Test, TestingModule } from '@nestjs/testing';
import { RegistrationService } from './registration.service';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { OrganizationsService } from '../../organizations/organizations.service';
import { MailService } from '../../mail/mail.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { User } from '../../users/entities/user.entity/user.entity';
import { Role } from '../../roles/entities/role.entity';
import { RoleEnum } from '../../roles/enums/role.enum';
import { RegisterUserDto } from '../dto/register-user.dto';
import { GoogleRecaptchaValidator } from '@nestlab/google-recaptcha';
import { RegistrationStrategyFactory } from '../strategies/registration/registration-strategy.factory';
import { LocalizationService } from '../../localization/services/localization.service';
import { MfaOrchestratorService } from './mfa-orchestrator.service';
import { PendingRegistration } from '../entities/pending-registration.entity';
import { PasswordService } from './password.service';
import { JwtService } from '@nestjs/jwt';
import { MembershipService } from '../../organizations/services/membership.service';
import { PaymentService } from '../../payment/payment.service';
import { ConfigService } from '@nestjs/config';

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
    transaction: jest.fn(),
  };

  const mockOrganizationsService = {
    create: jest.fn(),
  };

  const mockMailService = {
    sendDuplicateRegistrationEmail: jest.fn(),
    sendRegistrationFailedEmail: jest.fn(),
  };

  const mockPendingRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
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

  // `provision` is what gives a new tenant its chart of accounts and taxes. It is part of the
  // strategy contract now because registration CALLS it — for a long time nothing did, and the
  // only caller in the repository was the strategy's own unit test.
  const mockStrategy = {
    validate: jest.fn().mockResolvedValue(true),
    provision: jest.fn().mockResolvedValue(undefined),
  };
  const mockStrategyFactory = {
      getStrategy: jest.fn().mockReturnValue(mockStrategy)
  };

  const mockLocalizationService = {
      findById: jest.fn().mockResolvedValue({ countryCode: 'DO' })
  };

  // Signup charges before the account exists, so a materialisation failure has to be compensated.
  const mockPaymentService = {
      voidOrphanedSubscription: jest.fn().mockResolvedValue(undefined),
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
        { provide: MfaOrchestratorService, useValue: { verifyPublicCode: jest.fn().mockResolvedValue(true) } },
        { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn() } },
        { provide: getRepositoryToken(PendingRegistration), useValue: mockPendingRepo },
        // Password hashing routes through PasswordService so the configured Argon2id
        // parameters and the breach check are applied consistently everywhere.
        { provide: PasswordService, useValue: { hash: jest.fn().mockResolvedValue('hashed'), assertNotBreached: jest.fn().mockResolvedValue(undefined) } },
        // Memberships are written in the same transaction as the account, so the service needs
        // the real collaborator here even though these tests assert nothing about it.
        { provide: MembershipService, useValue: { grant: jest.fn(), listFor: jest.fn().mockResolvedValue([]) } },
        { provide: PaymentService, useValue: mockPaymentService },
        { provide: ConfigService, useValue: { get: jest.fn(() => false) } },
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

  /**
   * Duplicate-tenant detection during payment-first signup.
   *
   * The tax id is unique per fiscal region, not globally: the same nine digits can be a valid RNC
   * in the Dominican Republic and a valid identifier somewhere else, so the constraint has to
   * carry the region. These exercised `register()` — the unauthenticated, unpaid endpoint that no
   * longer exists — so they now go through the real signup path.
   */
  describe('completePendingRegistration', () => {
    const pending = {
      id: 'pending-1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      phone: null,
      phoneVerified: false,
      passwordHash: 'hashed',
      organizationName: 'Test Org',
      taxId: '123456789',
      fiscalRegionId: 'uuid-region',
      industry: null,
      companySize: null,
      address: null,
      planSlug: 'pro',
      status: 'pending',
    };

    const subscription = {
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      status: 'active',
      currentPeriodEnd: new Date(),
    };

    /** `dataSource.transaction(cb)` runs the callback with the mocked entity manager. */
    const runInTransaction = () =>
      (mockDataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (m: unknown) => unknown) => cb(mockQueryRunner.manager),
      );

    it('refuses a tax id already registered in the same fiscal region', async () => {
      runInTransaction();
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(pending) // the pending registration
        .mockResolvedValueOnce(null) // materializeAccount: no identity with this email yet
        .mockResolvedValueOnce({ id: 'existing-org' }); // an organization already holds the tax id

      await expect(
        service.completePendingRegistration('pending-1', subscription),
      ).rejects.toThrow(ConflictException);

      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Organization, {
        where: { taxId: '123456789', fiscalRegionId: 'uuid-region' },
      });
    });

    it('allows the same tax id in a different fiscal region', async () => {
      runInTransaction();
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(null) // no identity with this email yet
        .mockResolvedValueOnce(null) // nothing in THIS region holds the tax id
        .mockResolvedValueOnce({ id: 'plan-1', slug: 'pro' }); // the plan exists
      mockOrganizationsService.create.mockResolvedValue({ id: 'new-org', legalName: 'Test Org' });
      (mockQueryRunner.manager.create as jest.Mock).mockImplementation((_e, dto) => dto);
      (mockQueryRunner.manager.save as jest.Mock).mockResolvedValue([]);

      await expect(
        service.completePendingRegistration('pending-1', subscription),
      ).resolves.toBeDefined();

      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Organization, {
        where: { taxId: '123456789', fiscalRegionId: 'uuid-region' },
      });
    });

    /**
     * The payment has already been taken by this point. Creating the organization without a plan
     * used to be a logged warning — and an organization without a plan was exempt from every
     * limit in the product, so the least-provisioned tenant was also the least restricted.
     */
    it('refuses to provision an organization whose plan does not exist', async () => {
      runInTransaction();
      (mockQueryRunner.manager.findOne as jest.Mock)
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(null) // no identity with this email yet
        .mockResolvedValueOnce(null) // nothing holds the tax id
        .mockResolvedValueOnce(null); // the plan slug resolves to nothing
      mockOrganizationsService.create.mockResolvedValue({ id: 'new-org', legalName: 'Test Org' });
      (mockQueryRunner.manager.create as jest.Mock).mockImplementation((_e, dto) => dto);
      (mockQueryRunner.manager.save as jest.Mock).mockResolvedValue([]);

      await expect(
        service.completePendingRegistration('pending-1', subscription),
      ).rejects.toThrow(InternalServerErrorException);
    });

    /**
     * The customer has already been charged by the time materialisation runs.
     *
     * A failure used to roll the transaction back and stop there: no account, a live subscription
     * that would renew the following month, and no record anywhere that it had happened. These
     * tests pin the compensation — mark the row, undo the charge, tell the customer — because it
     * is the part nothing would notice missing again.
     */
    describe('when a paid registration cannot be materialised', () => {
      beforeEach(() => {
        runInTransaction();
        // The pending row is found, then the plan lookup returns nothing.
        (mockQueryRunner.manager.findOne as jest.Mock)
          .mockResolvedValueOnce(pending)
          .mockResolvedValue(null);
        mockOrganizationsService.create.mockResolvedValue({ id: 'new-org', legalName: 'Test Org' });
        (mockQueryRunner.manager.create as jest.Mock).mockImplementation((_e, dto) => dto);
        (mockQueryRunner.manager.save as jest.Mock).mockResolvedValue([]);
        (mockPendingRepo.findOne as jest.Mock).mockResolvedValue(pending);
      });

      it('records the failure against the pending registration', async () => {
        await expect(
          service.completePendingRegistration('pending-1', subscription),
        ).rejects.toThrow(InternalServerErrorException);

        expect(mockPendingRepo.update).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'pending-1' }),
          expect.objectContaining({
            status: 'failed',
            orphanedSubscriptionId: 'sub_1',
            failureReason: expect.any(String),
          }),
        );
      });

      it('cancels and refunds the subscription the customer paid for', async () => {
        await expect(
          service.completePendingRegistration('pending-1', subscription),
        ).rejects.toThrow(InternalServerErrorException);

        expect(mockPaymentService.voidOrphanedSubscription).toHaveBeenCalledWith(
          'sub_1',
          expect.stringContaining('pending-1'),
        );
      });

      it('tells the customer, with a reference they can quote to support', async () => {
        await expect(
          service.completePendingRegistration('pending-1', subscription),
        ).rejects.toThrow(InternalServerErrorException);

        expect(mockMailService.sendRegistrationFailedEmail).toHaveBeenCalledWith(
          pending.email,
          pending.firstName,
          'pending-1',
        );
      });

      it('still surfaces the original failure to the caller', async () => {
        // The compensation must not swallow the error: the confirm endpoint has to answer with a
        // failure, not report a success for an account that does not exist.
        await expect(
          service.completePendingRegistration('pending-1', subscription),
        ).rejects.toThrow(/Referencia: pending-1/);
      });
    });
  });

});
