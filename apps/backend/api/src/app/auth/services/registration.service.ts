
import { ConflictException, Injectable, InternalServerErrorException, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, EntityManager } from 'typeorm';
import * as argon2 from 'argon2';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoogleRecaptchaValidator } from '@nestlab/google-recaptcha';
import { JwtService } from '@nestjs/jwt';

import { RegisterUserDto } from '../dto/register-user.dto';
import { RegistrationStrategyFactory } from '../strategies/registration/registration-strategy.factory';
import { MfaOrchestratorService } from './mfa-orchestrator.service';
import { VerificationType } from '../entities/verification-code.entity';
import { LocalizationService } from '../../localization/services/localization.service';
import { User, UserStatus } from '../../users/entities/user.entity/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { Role } from '../../roles/entities/role.entity';
import { MailService } from '../../mail/mail.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { UserRegisteredEvent } from '../events/user-registered.event';
import { RoleEnum } from '../../roles/enums/role.enum';
import { DEFAULT_ROLES } from '../../config/roles.config';
import { AuthConfig } from '../auth.config';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { PendingRegistration, PendingRegistrationStatus } from '../entities/pending-registration.entity';
import { Plan } from '../../saas/entities/plan.entity';

/** Subscription facts captured from Stripe when a pending registration is completed. */
export interface CompletedSubscriptionInfo {
  customerId: string;
  subscriptionId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
}

const PENDING_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h to complete payment

interface MaterializeAccountData {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  phoneVerified: boolean;
  passwordHash: string;
  organizationName: string;
  taxId: string | null;
  fiscalRegionId: string | null;
  industry: string | null;
  companySize: string | null;
  address: string | null;
}

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly organizationsService: OrganizationsService,
    private readonly mailService: MailService,
    private readonly eventEmitter: EventEmitter2,
    private readonly recaptchaValidator: GoogleRecaptchaValidator,
    private readonly registrationStrategyFactory: RegistrationStrategyFactory,
    private readonly localizationService: LocalizationService,
    private readonly mfaOrchestratorService: MfaOrchestratorService,
    private readonly jwtService: JwtService,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(PendingRegistration)
    private readonly pendingRegistrationRepository: Repository<PendingRegistration>
  ) {}

  /**
   * Legacy direct registration: validates and creates the account in one step.
   * Retained for flows that don't gate on payment (e.g. invitations/social).
   * The payment-first signup uses {@link createPendingRegistration} +
   * {@link completePendingRegistration} instead.
   */
  async register(registerUserDto: RegisterUserDto) {
    await this.validateRegistration(registerUserDto);

    if (registerUserDto.fax) {
      return this.honeypotDummyUser(registerUserDto);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const passwordHash = await argon2.hash(registerUserDto.password);
      const { user } = await this.materializeAccount(
        {
          email: registerUserDto.email,
          firstName: registerUserDto.firstName,
          lastName: registerUserDto.lastName,
          phone: registerUserDto.phone ?? null,
          phoneVerified: !!registerUserDto.phoneVerificationCode,
          passwordHash,
          organizationName: registerUserDto.organizationName,
          taxId: registerUserDto.taxId ?? null,
          fiscalRegionId: registerUserDto.fiscalRegionId ?? null,
          industry: registerUserDto.industry ?? null,
          companySize: registerUserDto.companySize ?? null,
          address: registerUserDto.address ?? null,
        },
        queryRunner.manager
      );

      await queryRunner.commitTransaction();
      return user;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Error en el registro:', error);
      throw new InternalServerErrorException(
        'Error inesperado, por favor revise los logs del servidor.',
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Validates a registration (reCAPTCHA, verification codes, fiscal strategy)
   * WITHOUT persisting anything. Throws on any failure. Honeypot is handled by
   * the caller so it can return a believable success to bots.
   */
  private async validateRegistration(dto: RegisterUserDto): Promise<void> {
    const { email, phone, emailVerificationCode, phoneVerificationCode, fiscalRegionId, recaptchaToken } = dto;

    const recaptchaResult = await this.recaptchaValidator.validate({
      response: recaptchaToken,
      score: 0.5,
      action: 'register',
    });

    if (!recaptchaResult.success) {
      const emailHash = createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 12);
      this.logger.warn({ event: 'recaptcha_failed', emailHash, errors: recaptchaResult.errors }, 'Recaptcha validation failed');
      throw new ForbiddenException('Error de validación de seguridad (reCAPTCHA).');
    }

    if (dto.fax) {
      // Honeypot: stop validating but don't reveal anything. Caller short-circuits.
      return;
    }

    if (!emailVerificationCode) {
      throw new BadRequestException('El código de verificación de correo es obligatorio.');
    }
    await this.verifyCode(email, VerificationType.EMAIL_VERIFY, emailVerificationCode);

    if (phone && phoneVerificationCode) {
      await this.verifyCode(phone, VerificationType.PHONE_VERIFY, phoneVerificationCode);
    } else if (phone && !phoneVerificationCode) {
      throw new BadRequestException('El código de verificación de celular es obligatorio.');
    }

    if (fiscalRegionId) {
      const region = await this.localizationService.findById(fiscalRegionId);
      if (region) {
        const strategy = this.registrationStrategyFactory.getStrategy(region.countryCode);
        await strategy.validate(dto);
      }
    }
  }

  /**
   * Creates organization + admin role + admin user inside the given transaction
   * and emits the provisioning event. Pure persistence — all validation must
   * have happened already. Reused by both the direct and payment-first flows.
   */
  private async materializeAccount(data: MaterializeAccountData, manager: EntityManager): Promise<{ user: User; organization: Organization }> {
    const existingUser = await manager.findOne(User, { where: { email: data.email } });
    if (existingUser) {
      try {
        await this.mailService.sendDuplicateRegistrationEmail(data.email, existingUser.firstName);
      } catch (e) {
        this.logger.error('Failed to send duplicate registration email', e);
      }
      await this.simulateDelay();
      throw new ConflictException('No se pudo completar el registro. Verifique que los datos sean correctos o contacte soporte.');
    }

    let taxId = data.taxId;
    if (taxId) {
      taxId = taxId.replace(/[^\d]/g, '');
      const whereClause: any = { taxId };
      if (data.fiscalRegionId) {
        whereClause.fiscalRegionId = data.fiscalRegionId;
      }
      const existingOrg = await manager.findOne(Organization, { where: whereClause });
      if (existingOrg) {
        throw new ConflictException('No se pudo completar el registro. Verifique que los datos sean correctos o contacte soporte.');
      }
    }

    const organization = await this.organizationsService.create(
      {
        legalName: data.organizationName,
        taxId: taxId || null,
        fiscalRegionId: data.fiscalRegionId,
        industry: data.industry,
        companySize: data.companySize,
        address: data.address,
      },
      manager
    );

    const defaultRoles = this.getDefaultRolesForOrganization(organization.id);
    const roleEntities = defaultRoles.map((role) => manager.create(Role, { ...role }));
    await manager.save(roleEntities);

    const adminRole = roleEntities.find((r) => r.name === RoleEnum.ADMINISTRATOR);
    if (!adminRole) {
      throw new InternalServerErrorException('No se pudo encontrar el rol de administrador predeterminado.');
    }

    const userSecurity = manager.create(UserSecurity, {
      passwordHash: data.passwordHash,
      failedLoginAttempts: 0,
      lockoutUntil: null,
    });

    const user = manager.create(User, {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone ?? undefined,
      isEmailVerified: true,
      isPhoneVerified: data.phoneVerified,
      organization,
      organizationId: organization.id,
      roles: [adminRole],
      status: UserStatus.ACTIVE,
      security: userSecurity,
    });
    await manager.save(user);

    await this.eventEmitter.emitAsync(
      'user.registered',
      new UserRegisteredEvent(user, organization, manager)
    );

    user.organization = organization;
    user.roles = [adminRole];

    return { user, organization };
  }

  /**
   * Payment-first signup step 1: validates everything and stores a pending
   * registration (password hashed). NO account is created yet — that happens
   * only once Stripe confirms the payment. Returns the pending row (or a dummy
   * for honeypot hits).
   */
  async createPendingRegistration(dto: RegisterUserDto, planSlug: string): Promise<PendingRegistration | null> {
    await this.validateRegistration(dto);

    if (dto.fax) {
      this.logger.warn(`Spam registration detected (Honeypot): ${dto.email}`);
      await this.simulateDelay();
      return null;
    }

    // Pre-flight duplicate check for fast, friendly feedback. The DB unique
    // constraint + completion idempotency remain the real safety net.
    const existingUser = await this.organizationRepository.manager.findOne(User, { where: { email: dto.email } });
    if (existingUser) {
      try {
        await this.mailService.sendDuplicateRegistrationEmail(dto.email, existingUser.firstName);
      } catch (e) {
        this.logger.error('Failed to send duplicate registration email', e);
      }
      await this.simulateDelay();
      throw new ConflictException('No se pudo completar el registro. Verifique que los datos sean correctos o contacte soporte.');
    }

    const passwordHash = await argon2.hash(dto.password);

    const pending = this.pendingRegistrationRepository.create({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone ?? null,
      phoneVerified: !!dto.phoneVerificationCode,
      passwordHash,
      organizationName: dto.organizationName,
      taxId: dto.taxId ?? null,
      fiscalRegionId: dto.fiscalRegionId ?? null,
      industry: dto.industry ?? null,
      companySize: dto.companySize ?? null,
      address: dto.address ?? null,
      planSlug,
      status: PendingRegistrationStatus.PENDING,
      expiresAt: new Date(Date.now() + PENDING_REGISTRATION_TTL_MS),
    });

    return this.pendingRegistrationRepository.save(pending);
  }

  async attachSessionToPending(pendingId: string, sessionId: string): Promise<void> {
    await this.pendingRegistrationRepository.update({ id: pendingId }, { stripeSessionId: sessionId });
  }

  /**
   * Payment-first signup step 2: materializes the account from a pending
   * registration once payment is confirmed, assigns the plan + subscription
   * facts, and marks the pending row completed. Idempotent: if the account was
   * already created (e.g. webhook + redirect race), returns the existing user.
   */
  async completePendingRegistration(pendingId: string, subscription: CompletedSubscriptionInfo): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const pending = await manager.findOne(PendingRegistration, { where: { id: pendingId } });
      if (!pending) {
        throw new BadRequestException('Registro pendiente no encontrado o expirado.');
      }

      // Idempotency: the webhook and the frontend confirm call can race. If the
      // account already exists for this email, return it instead of erroring.
      const existing = await manager.findOne(User, {
        where: { email: pending.email },
        relations: ['organization', 'roles'],
      });
      if (existing) {
        if (pending.status !== PendingRegistrationStatus.COMPLETED) {
          pending.status = PendingRegistrationStatus.COMPLETED;
          await manager.save(pending);
        }
        return existing;
      }

      const { user, organization } = await this.materializeAccount(
        {
          email: pending.email,
          firstName: pending.firstName,
          lastName: pending.lastName,
          phone: pending.phone,
          phoneVerified: pending.phoneVerified,
          passwordHash: pending.passwordHash,
          organizationName: pending.organizationName,
          taxId: pending.taxId,
          fiscalRegionId: pending.fiscalRegionId,
          industry: pending.industry,
          companySize: pending.companySize,
          address: pending.address,
        },
        manager
      );

      // Link the paid subscription to the new organization.
      organization.externalCustomerId = subscription.customerId;
      organization.externalSubscriptionId = subscription.subscriptionId;
      organization.subscriptionStatus = subscription.status;
      organization.subscriptionPeriodEnd = subscription.currentPeriodEnd;

      const plan = await manager.findOne(Plan, { where: { slug: pending.planSlug } });
      if (plan) {
        organization.plan = plan;
        organization.planId = plan.id;
      } else {
        this.logger.warn(`Plan slug ${pending.planSlug} not found while completing registration ${pendingId}.`);
      }
      await manager.save(organization);

      pending.status = PendingRegistrationStatus.COMPLETED;
      await manager.save(pending);

      this.logger.log(`Materialized account for ${pending.email} (org ${organization.id}, plan ${pending.planSlug}).`);
      return user;
    });
  }

  private honeypotDummyUser(dto: RegisterUserDto): User {
    this.logger.warn(`Spam registration detected (Honeypot): ${dto.email}`);
    const dummyUser = new User();
    dummyUser.email = dto.email;
    dummyUser.firstName = dto.firstName;
    dummyUser.lastName = dto.lastName;
    return dummyUser;
  }

  private async verifyCode(target: string, type: VerificationType, code: string) {
    if (this.isPreVerifiedToken(code)) {
      let payload: { sub: string; verType: string; type: string };
      try {
        payload = this.jwtService.verify(code, {
          secret: AuthConfig.JWT_PREVERIFY_SECRET,
        });
      } catch {
        throw new BadRequestException('El código de verificación ha expirado o no es válido.');
      }
      if (payload.type !== 'VERIFICATION_PRE_VERIFIED' || payload.sub !== target || payload.verType !== type) {
        throw new BadRequestException('El código de verificación no coincide.');
      }
    } else {
      await this.mfaOrchestratorService.verifyPublicCode(target, type, code);
    }
  }

  private isPreVerifiedToken(code: string): boolean {
    return code.split('.').length === 3;
  }

  private getDefaultRolesForOrganization(organizationId: string) {
    return DEFAULT_ROLES.map(role => ({
        ...role,
        organizationId
    }));
  }

  private async simulateDelay() {
    return new Promise((resolve) => setTimeout(resolve, AuthConfig.SIMULATED_DELAY_MS));
  }
}
