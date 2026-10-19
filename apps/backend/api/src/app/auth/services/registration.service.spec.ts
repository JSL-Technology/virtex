import { LEGAL_DOCUMENTS } from '@virteex/shared/types';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterCheckoutDto } from '../dto/register-checkout.dto';

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
import { RegistrationPaymentPort } from '../ports/registration-payment.port';
import { ConfigService } from '@nestjs/config';
import { UserCacheService } from '../modules/user-cache.service';
import { expectLocalizedError } from '../../i18n/testing/expect-localized-error';

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
        // El PUERTO, no el servicio concreto: `RegistrationPaymentPort` se introdujo para
        // desacoplar Auth de PaymentService (B-01), y el módulo de prueba se quedó declarando la
        // clase. Nest no resolvía las dependencias, así que las pruebas del alta —el camino que
        // da libros a un cliente que paga— no se han ejecutado desde entonces. El doble es el
        // mismo; solo cambia con qué llave se registra.
        { provide: RegistrationPaymentPort, useValue: mockPaymentService },
        // Repairing a tenant drops the cached principals of its members, or the entitlement it
        // just wrote stays invisible until the cache expires. Nothing here asserts on it.
        { provide: UserCacheService, useValue: { clearOrganizationMembers: jest.fn() } },
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
        await expectLocalizedError(
          service.completePendingRegistration('pending-1', subscription),
          'auth.your_plan_could_not_activated_your',
          { pendingId: 'pending-1' },
        );
      });
    });
  });


  /**
   * A signed-in person adding another company. The identity is the session's, never the body's;
   * the company goes through the same fiscal validation and duplicate check as a signup; and the
   * stored password hash can never be signed into, because the existing account keeps its own.
   */
  /**
   * The phone is optional, and so is its verification. The signup screen lets a person continue
   * with the number unverified when the SMS channel is down and promises they can confirm it later;
   * the server used to refuse exactly that payload on the last step.
   */
  describe('phone verification at signup', () => {
    const dto = {
      email: 'owner@example.do',
      emailVerificationCode: '123456',
      phone: '+18095551234',
      recaptchaToken: 'token',
      countryCode: 'DO',
      taxId: '131234569',
    } as unknown as RegisterUserDto;
    const validate = (input: RegisterUserDto) =>
      (service as unknown as { validateRegistration(d: RegisterUserDto): Promise<void> }).validateRegistration(input);

    it('accepts a phone number without a code, leaving it unverified', async () => {
      await expect(validate(dto)).resolves.toBeUndefined();
    });

    it('still checks a code when one is sent', async () => {
      const mfa = (service as unknown as { mfaOrchestratorService: { verifyPublicCode: jest.Mock } })
        .mfaOrchestratorService;
      await validate({ ...dto, phoneVerificationCode: '654321' } as RegisterUserDto);
      expect(mfa.verifyPublicCode).toHaveBeenCalledWith('+18095551234', expect.anything(), '654321');
    });
  });

  /**
   * QA C-07: an account could be created without accepting the Terms, and an acceptance given
   * could not be shown afterwards. The pending signup now carries it — editions, when, from where —
   * and the account is materialised with it.
   */
  describe('consent to the Terms and the Privacy policy', () => {
    const dto = {
      email: 'owner@example.do',
      emailVerificationCode: '123456',
      recaptchaToken: 'token',
      countryCode: 'DO',
      taxpayerKind: 'company',
      taxId: '131234569',
      password: 'Sup3r-Segura-2026!',
      firstName: 'Ana',
      lastName: 'Pérez',
      organizationName: 'Acme',
      acceptTerms: true,
      termsVersion: LEGAL_DOCUMENTS.terms.version,
      privacyVersion: LEGAL_DOCUMENTS.privacy.version,
    } as unknown as RegisterUserDto;
    const consent = {
      termsVersion: LEGAL_DOCUMENTS.terms.version,
      privacyVersion: LEGAL_DOCUMENTS.privacy.version,
      acceptedAt: new Date('2026-10-12T10:00:00Z'),
      ipAddress: '203.0.113.7',
      userAgent: 'jest',
    };

    beforeEach(() => {
      (mockLocalizationService as unknown as { findRegionByCountryCode: jest.Mock }).findRegionByCountryCode = jest
        .fn()
        .mockResolvedValue({ id: 'region-do' });
      mockPendingRepo.create.mockImplementation((row: unknown) => row);
      mockPendingRepo.save.mockImplementation(async (row: unknown) => row);
    });

    it('stores which editions were accepted, when, and from which address', async () => {
      const pending = await service.createPendingRegistration(dto, 'pro', consent);

      expect(pending).toMatchObject({
        termsVersion: LEGAL_DOCUMENTS.terms.version,
        privacyVersion: LEGAL_DOCUMENTS.privacy.version,
        termsAcceptedAt: consent.acceptedAt,
        termsAcceptedIp: '203.0.113.7',
        termsAcceptedUserAgent: 'jest',
      });
    });

    it('refuses a signup that did not accept, before anything is stored', async () => {
      await expect(
        service.createPendingRegistration({ ...dto, acceptTerms: false } as unknown as RegisterUserDto, 'pro', consent),
      ).rejects.toMatchObject({ messageKey: 'validation.register_checkout.terms_must_be_accepted' });
      expect(mockPendingRepo.save).not.toHaveBeenCalled();
    });

    it('refuses an edition that is no longer in force', async () => {
      await expect(
        service.createPendingRegistration(dto, 'pro', { ...consent, termsVersion: '2020-01-01' }),
      ).rejects.toMatchObject({ messageKey: 'validation.register_checkout.legal_version_outdated' });
    });

    it('rejects the payload at the edge when the box was not ticked', async () => {
      const payload = plainToInstance(RegisterCheckoutDto, { acceptTerms: false, termsVersion: 'old', privacyVersion: 'old' });
      const errors = await validate(payload);
      const byProperty = Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})]));
      expect(byProperty['acceptTerms']).toContain('validation.register_checkout.terms_must_be_accepted');
      expect(byProperty['termsVersion']).toContain('validation.register_checkout.legal_version_outdated');
      expect(byProperty['privacyVersion']).toContain('validation.register_checkout.legal_version_outdated');
    });

    it('copies the acceptance onto the person when the account is materialised', async () => {
      const manager = { create: jest.fn((_e: unknown, row: unknown) => row), save: jest.fn() };
      const record = (service as unknown as {
        recordConsent(p: unknown, u: string, o: string, m: unknown): Promise<void>;
      }).recordConsent.bind(service);

      await record(
        {
          termsVersion: LEGAL_DOCUMENTS.terms.version,
          privacyVersion: LEGAL_DOCUMENTS.privacy.version,
          termsAcceptedAt: consent.acceptedAt,
          termsAcceptedIp: '203.0.113.7',
          termsAcceptedUserAgent: 'jest',
        },
        'user-1',
        'org-1',
        manager,
      );

      const rows = manager.save.mock.calls[0][1];
      expect(rows).toEqual([
        expect.objectContaining({ userId: 'user-1', organizationId: 'org-1', document: 'terms', version: LEGAL_DOCUMENTS.terms.version, ipAddress: '203.0.113.7' }),
        expect.objectContaining({ document: 'privacy', version: LEGAL_DOCUMENTS.privacy.version }),
      ]);
    });

    it('invents no acceptance for a signup that predates consent being recorded', async () => {
      const manager = { create: jest.fn(), save: jest.fn() };
      await (service as unknown as { recordConsent(p: unknown, u: string, o: string, m: unknown): Promise<void> })
        .recordConsent({ termsAcceptedAt: null }, 'user-1', 'org-1', manager);
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('createPendingAdditionalCompany', () => {
    const identity = { email: 'ana@example.com', firstName: 'Ana', lastName: 'Pérez' };
    const company = {
      organizationName: 'Segunda Empresa SRL',
      countryCode: 'do',
      taxpayerKind: 'company',
      taxId: '131000001',
      address: 'Av. 27 de Febrero 1',
      city: 'Santo Domingo',
      state: 'DN',
    } as never;

    beforeEach(() => {
      (mockLocalizationService as Record<string, unknown>)['findRegionByCountryCode'] = jest
        .fn()
        .mockResolvedValue({ id: 'region-do' });
      mockPendingRepo.create.mockImplementation((row: unknown) => row);
      mockPendingRepo.save.mockImplementation(async (row: unknown) => ({ id: 'pending-2', ...(row as object) }));
    });

    it('builds the pending company from the session identity, with an unusable password', async () => {
      mockOrganizationRepo.findOne.mockResolvedValue(null);

      const pending = await service.createPendingAdditionalCompany(identity, company, 'pro');

      expect(mockStrategy.validate).toHaveBeenCalled();
      expect(pending).toMatchObject({
        email: 'ana@example.com',
        firstName: 'Ana',
        lastName: 'Pérez',
        organizationName: 'Segunda Empresa SRL',
        countryCode: 'DO',
        fiscalRegionId: 'region-do',
        planSlug: 'pro',
      });
      expect((pending as unknown as { passwordHash: string }).passwordHash).toBe('!unusable');
    });

    it('refuses a company whose tax id is already on the platform, before any payment', async () => {
      mockOrganizationRepo.findOne.mockResolvedValue({ id: 'taken' });
      jest.spyOn(service as unknown as { simulateDelay: () => Promise<void> }, 'simulateDelay').mockResolvedValue();

      await expect(service.createPendingAdditionalCompany(identity, company, 'pro')).rejects.toMatchObject({
        messageKey: 'auth.organization_tax_id_already_registered',
      });
      expect(mockPendingRepo.save).not.toHaveBeenCalled();
    });
  });
});
