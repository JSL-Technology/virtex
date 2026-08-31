
import { ConflictException, Inject, Injectable, InternalServerErrorException, Logger, ForbiddenException, BadRequestException, forwardRef } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, EntityManager } from 'typeorm';
import * as argon2 from 'argon2';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoogleRecaptchaValidator } from '@nestlab/google-recaptcha';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

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
import { PasswordService } from './password.service';
import { PendingRegistration, PendingRegistrationStatus } from '../entities/pending-registration.entity';
import { Plan } from '../../saas/entities/plan.entity';
import { MembershipService } from '../../organizations/services/membership.service';
import { canonicalizeTaxId } from '../../localization/fiscal/tax-id-validators';
import { normalizeFiscalFields } from '../../localization/fiscal/country-profiles';
import { PaymentService } from '../../payment/payment.service';

/** Subscription facts captured from Stripe when a pending registration is completed. */
export interface CompletedSubscriptionInfo {
  customerId: string;
  subscriptionId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
}

/**
 * How long a started signup may take to complete payment.
 *
 * Read from AuthConfig so the pending row and the transaction cookie that binds it to a browser
 * cannot be given different lifetimes — a cookie that expires first means a paid customer who
 * cannot be signed in.
 */
const PENDING_REGISTRATION_TTL_MS = AuthConfig.PENDING_REGISTRATION_TTL;

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
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  taxpayerKind: string | null;
  fiscalProfile: Record<string, string> | null;
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
    private readonly pendingRegistrationRepository: Repository<PendingRegistration>,
    private readonly passwordService: PasswordService,
    private readonly membershipService: MembershipService,
    private readonly configService: ConfigService,
    // forwardRef: PaymentModule already depends on AuthModule for its guards, so the two modules
    // reference each other. Needed here to undo a charge whose account could not be created.
    @Inject(forwardRef(() => PaymentService))
    private readonly paymentService: PaymentService,
  ) {}

  /**
   * Validates a registration (reCAPTCHA, verification codes, fiscal strategy)
   * WITHOUT persisting anything. Throws on any failure. Honeypot is handled by
   * the caller so it can return a believable success to bots.
   */
  private async validateRegistration(dto: RegisterUserDto): Promise<void> {
    const { email, phone, emailVerificationCode, phoneVerificationCode, recaptchaToken } = dto;

    /**
     * reCAPTCHA, honouring the same switch the guards honour.
     *
     * `GoogleRecaptchaGuard` respects `skipIf`, which the application wires to
     * `RECAPTCHA_DISABLED`. This validator does NOT — `validate()` performs the network call
     * whatever the module is configured with. Signup is the one flow whose reCAPTCHA check lives
     * here rather than on a guard, so with the flag on (its default in development) every
     * `POST /auth/register-checkout` answered
     * "Error de validación de seguridad (reCAPTCHA)" and the product could not be signed up for
     * locally at all — while the README described the flag as making the check "skip".
     *
     * Read from the same variable rather than from NODE_ENV: staging must keep the check unless
     * somebody deliberately turns it off, which is the rule `auth.config.ts` and the environment
     * schema already encode.
     */
    const recaptchaDisabled = this.configService.get<boolean>('RECAPTCHA_DISABLED', false) === true;

    if (!recaptchaDisabled) {
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

    // The country's registration rules are not conditional on anything. This used to run only
    // when the payload happened to carry a `fiscalRegionId`, and only when that id resolved to a
    // row — so a client that simply omitted the field skipped fiscal validation entirely, and a
    // stale id skipped it silently. `getStrategy` now throws for a country the product does not
    // support, which is the only safe outcome for a fiscal product.
    const strategy = this.registrationStrategyFactory.getStrategy(dto.countryCode);
    await strategy.validate(dto);
  }

  /**
   * Resolve the `fiscal_regions` row for a country code.
   *
   * The client's `fiscalRegionId` is deliberately ignored: it is attacker-controlled and, if it
   * disagreed with `countryCode`, the tenant would be validated under one country's rules and
   * provisioned under another's. The country is the single input; the row is derived from it.
   */
  private async resolveFiscalRegionId(countryCode: string): Promise<string> {
    const region = await this.localizationService.findRegionByCountryCode(
      countryCode.toUpperCase(),
    );
    if (!region) {
      this.logger.error(
        { event: 'fiscal_region_missing', countryCode },
        '[REGISTRATION] Supported country has no fiscal_regions row; boot seeding failed.',
      );
      throw new InternalServerErrorException(
        'La configuración fiscal de ese país no está disponible en este momento.',
      );
    }
    return region.id;
  }

  /**
   * Creates organization + admin role + admin user inside the given transaction
   * and emits the provisioning event. Pure persistence — all validation must
   * have happened already. Reused by both the direct and payment-first flows.
   */
  private async materializeAccount(
    data: MaterializeAccountData,
    manager: EntityManager,
  ): Promise<{ user: User; organization: Organization; isNewIdentity: boolean }> {
    /**
     * Somebody who already uses the product signing their SECOND company up.
     *
     * This used to be a `ConflictException`: `users.email` is globally unique, so an existing
     * address meant "duplicate registration" and the signup was refused after the customer had
     * paid. For an ERP sold across nineteen markets that is precisely backwards — accountants,
     * bookkeepers and consultants running several companies are not an edge case, they are the
     * segment, and the platform's whole multi-tenancy exists so one identity can hold several
     * tenants. The only thing standing in the way was this branch.
     *
     * Reusing the identity is safe because the signup has already PROVEN control of the mailbox:
     * `validateRegistration` verifies an emailed code against this exact address before anything
     * reaches here. Nothing about the existing account is touched — not the password, not the
     * status, not the home organization. What the person gains is a new tenant, a membership in
     * it, and the administrator role scoped to it.
     */
    const existingUser = await manager.findOne(User, {
      where: { email: data.email },
      relations: ['roles'],
    });

    // The tax id is stored in the country's canonical form, NOT as bare digits.
    //
    // `taxId.replace(/[^\d]/g, '')` deleted every non-digit for every country, which is not
    // normalisation but destruction. It reduced `DEM010203AB5` to `0102035`, so every Mexican
    // company incorporated on the same date collapsed to one stored value — and `organizations`
    // carries a unique index on `(tax_id, fiscal_region_id)`, so the second one to sign up was
    // rejected with a generic conflict, after paying. It also dropped the `K` from Chilean and
    // Guatemalan check characters and the type letter that separates a Venezuelan company from a
    // natural person. See `canonicalizeTaxId`.
    let taxId: string | null = null;
    if (data.taxId) {
      taxId = data.countryCode
        ? canonicalizeTaxId(data.countryCode, data.taxId)
        : data.taxId.trim();

      const whereClause: Record<string, unknown> = { taxId };
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
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.countryCode,
      },
      manager
    );

    // Fiscal identity, written on the same row the organization was just created with. The
    // identifier has been validated arithmetically and canonicalised in this request, so it is
    // verified by construction — unlike the rows that predate the canonical form.
    organization.taxpayerKind = data.taxpayerKind;
    organization.fiscalProfile = data.fiscalProfile ?? null;
    organization.taxIdVerifiedAt = taxId ? new Date() : null;
    await manager.save(Organization, organization);

    const defaultRoles = this.getDefaultRolesForOrganization(organization.id);
    const roleEntities = defaultRoles.map((role) => manager.create(Role, { ...role }));
    await manager.save(roleEntities);

    const adminRole = roleEntities.find((r) => r.name === RoleEnum.ADMINISTRATOR);
    if (!adminRole) {
      throw new InternalServerErrorException('No se pudo encontrar el rol de administrador predeterminado.');
    }

    let user: User;

    if (existingUser) {
      // An identity that already exists gains a role in the NEW tenant and nothing else. Roles
      // carry `organization_id`, so this grants no rights anywhere they already work, and their
      // active organization is deliberately left alone — they can switch to the new one when
      // they choose, rather than being moved out from under whatever they had open.
      existingUser.roles = [...(existingUser.roles ?? []), adminRole];
      await manager.save(User, existingUser);
      user = existingUser;
    } else {
      const userSecurity = manager.create(UserSecurity, {
        passwordHash: data.passwordHash,
        failedLoginAttempts: 0,
        lockoutUntil: null,
      });

      user = manager.create(User, {
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
    }

    // The owner's membership, written in the same transaction that creates them. Registration
    // never wrote this row, so `user_organizations` held only what a one-off backfill had put
    // there and every tenant created since was invisible to the multi-tenancy that depends on it.
    await this.membershipService.grant(user.id, organization.id, manager);

    // The country's chart of accounts and taxes — IN this transaction, awaited, and fatal on
    // failure.
    //
    // This is what an ERP alta is FOR, and it never ran. `ProfileRegistrationStrategy.provision()`
    // existed and its only caller was its own unit test; the `user.registered` event below was
    // supposed to carry it, and its single listener had an empty body described as a
    // "Placeholder implementation to satisfy build requirements". So every tenant that ever paid
    // opened its books with zero accounts and zero taxes: no journal entry, no invoice, no period
    // close — a fiscal product that cannot post a debit.
    //
    // Deliberately NOT an event listener. `emitAsync` swallows the distinction between "no
    // subscriber", "subscriber threw" and "subscriber succeeded", which is exactly how this got
    // lost; and provisioning must share the transaction, so a chart of accounts that fails
    // half-written rolls back with the account rather than leaving a tenant nobody can use.
    if (data.countryCode) {
      const strategy = this.registrationStrategyFactory.getStrategy(data.countryCode);
      await strategy.provision(organization, user, manager);
    }

    // Kept as an integration point (outbound webhooks subscribe to it), but nothing the tenant
    // needs in order to function may depend on a listener existing.
    await this.eventEmitter.emitAsync(
      'user.registered',
      new UserRegisteredEvent(user, organization, manager)
    );

    // The caller signs the person into the tenant they just paid for, so the principal it gets
    // back describes THAT tenant — for an existing identity the stored `organizationId` still
    // points at their previous one, which is correct in the database and wrong in this response.
    user.organization = organization;
    user.organizationId = organization.id;
    user.roles = [adminRole];

    return { user, organization, isNewIdentity: !existingUser };
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

    const fiscalRegionId = await this.resolveFiscalRegionId(dto.countryCode);

    /**
     * The fiscal identity is checked BEFORE the customer is sent to Stripe.
     *
     * `organizations` carries a unique index on `(tax_id, fiscal_region_id)`, and the only place
     * that used to be evaluated was `materializeAccount` — which runs after the charge. So a
     * company that was already registered paid first and was told "no se pudo completar el
     * registro" second, and the platform then had to cancel the subscription and issue a refund.
     * The check costs one indexed lookup and moves the rejection to where the customer can still
     * do something about it.
     *
     * The email is deliberately NOT pre-checked any more: an address that already exists is a
     * customer registering an additional company, which is now supported (see
     * `materializeAccount`).
     */
    const canonicalTaxId = canonicalizeTaxId(dto.countryCode, dto.taxId);
    const duplicateOrg = await this.organizationRepository.findOne({
      where: { taxId: canonicalTaxId, fiscalRegionId },
    });
    if (duplicateOrg) {
      await this.simulateDelay();
      throw new ConflictException(
        'Ya existe una organización registrada con ese identificador fiscal. ' +
          'Si trabajas en esa empresa, pide a un administrador que te invite.',
      );
    }

    await this.passwordService.assertNotBreached(dto.password);
    const passwordHash = await this.passwordService.hash(dto.password);

    const pending = this.pendingRegistrationRepository.create({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone ?? null,
      phoneVerified: !!dto.phoneVerificationCode,
      passwordHash,
      organizationName: dto.organizationName,
      taxId: dto.taxId ?? null,
      taxpayerKind: dto.taxpayerKind ?? null,
      // Only the answers the country actually asks for are kept. The DTO constraint has already
      // rejected unknown keys; normalising again here means a future caller that reaches this
      // service without the HTTP pipe cannot store arbitrary data either.
      fiscalProfile: normalizeFiscalFields(
        dto.countryCode,
        dto.taxpayerKind as 'company' | 'individual' | undefined,
        dto.fiscalProfile ?? {},
      ),
      fiscalRegionId,
      industry: dto.industry ?? null,
      companySize: dto.companySize ?? null,
      address: dto.address ?? null,
      city: dto.city ?? null,
      state: dto.state ?? null,
      postalCode: dto.postalCode ?? null,
      countryCode: dto.countryCode.toUpperCase(),
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
    try {
      return await this.materializePaidRegistration(pendingId, subscription);
    } catch (error) {
      // The customer has ALREADY been charged at this point. A failure here used to roll the
      // transaction back and stop: no account, a live subscription that would renew next month,
      // no record that any of it happened, and a screen telling the customer to "sign in in a
      // few minutes" to an account that does not exist.
      //
      // Recording the failure and undoing the charge is the compensating action. It is done
      // outside the transaction that just rolled back, and its own failure is contained, because
      // a compensation that can throw turns one bad outcome into two.
      await this.recordMaterializationFailure(pendingId, subscription, error as Error);
      throw error;
    }
  }

  /**
   * Mark a paid signup as unrecoverable and undo its charge.
   *
   * Leaves the row in `FAILED` with the reason and the subscription id on it, so the charge is a
   * work item somebody can resolve rather than an invisible loss. The row is deliberately NOT
   * deleted: it is the only record that this person paid.
   */
  private async recordMaterializationFailure(
    pendingId: string,
    subscription: CompletedSubscriptionInfo,
    error: Error,
  ): Promise<void> {
    this.logger.error(
      {
        event: 'registration_materialization_failed',
        pendingId,
        subscriptionId: subscription.subscriptionId,
        reason: error.message,
      },
      '[BILLING] A paid registration could not be materialised. The customer has been charged.',
    );

    try {
      await this.pendingRegistrationRepository.update(
        { id: pendingId, status: PendingRegistrationStatus.PENDING },
        {
          status: PendingRegistrationStatus.FAILED,
          failureReason: error.message.slice(0, 500),
          orphanedSubscriptionId: subscription.subscriptionId,
        },
      );
    } catch (updateError) {
      this.logger.error(
        { event: 'registration_failure_not_recorded', pendingId },
        `Could not record the failure: ${(updateError as Error).message}`,
      );
    }

    if (subscription.subscriptionId) {
      await this.paymentService.voidOrphanedSubscription(
        subscription.subscriptionId,
        `registration ${pendingId} could not be materialised: ${error.message}`,
      );
    }

    const pending = await this.pendingRegistrationRepository.findOne({ where: { id: pendingId } });
    if (pending) {
      try {
        await this.mailService.sendRegistrationFailedEmail(pending.email, pending.firstName, pendingId);
      } catch (mailError) {
        this.logger.error(
          { event: 'registration_failure_email_not_sent', pendingId },
          `Could not tell the customer: ${(mailError as Error).message}`,
        );
      }
    }
  }

  private async materializePaidRegistration(pendingId: string, subscription: CompletedSubscriptionInfo): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const pending = await manager.findOne(PendingRegistration, { where: { id: pendingId } });
      if (!pending) {
        throw new BadRequestException('Registro pendiente no encontrado o expirado.');
      }

      // Idempotency: the Stripe webhook and the browser's confirm call race each other, and both
      // land here. The question is whether THIS signup has already produced its organization —
      // not whether a user with this email exists anywhere, which is what it used to ask and
      // which now has a legitimate "yes" for every customer registering a second company.
      if (pending.organizationId) {
        const already = await manager.findOne(User, {
          where: { email: pending.email },
          relations: ['roles'],
        });
        if (already) {
          if (pending.status !== PendingRegistrationStatus.COMPLETED) {
            pending.status = PendingRegistrationStatus.COMPLETED;
            await manager.save(pending);
          }
          // Report the tenant THIS signup created, not the user's home organization: for an
          // existing identity registering a second company they are different rows.
          already.organization =
            (await manager.findOne(Organization, { where: { id: pending.organizationId } })) ??
            undefined;
          already.organizationId = pending.organizationId;
          return already;
        }
      }

      const { user, organization, isNewIdentity } = await this.materializeAccount(
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
          city: pending.city,
          state: pending.state,
          postalCode: pending.postalCode,
          countryCode: pending.countryCode,
          taxpayerKind: pending.taxpayerKind,
          fiscalProfile: pending.fiscalProfile,
        },
        manager
      );

      // Link the paid subscription to the new organization.
      organization.externalCustomerId = subscription.customerId;
      organization.externalSubscriptionId = subscription.subscriptionId;
      organization.subscriptionStatus = subscription.status;
      organization.subscriptionPeriodEnd = subscription.currentPeriodEnd;

      // An organization without a plan is exempt from every limit in the product, so this used
      // to log a warning and carry on — creating exactly the tenant that could consume without
      // bound. The payment has already been taken at this point, so failing loudly (and rolling
      // the transaction back) is the only correct outcome: the customer is charged and the
      // account is not silently mis-provisioned.
      const plan = await manager.findOne(Plan, { where: { slug: pending.planSlug } });
      if (!plan) {
        this.logger.error(
          { event: 'registration_plan_missing', pendingId, planSlug: pending.planSlug },
          '[BILLING] Paid registration references a plan that does not exist.',
        );
        throw new InternalServerErrorException(
          `No se pudo activar tu plan. Tu pago está registrado y lo estamos revirtiendo automáticamente. Referencia: ${pendingId}.`,
        );
      }
      organization.plan = plan;
      organization.planId = plan.id;
      await manager.save(organization);

      pending.status = PendingRegistrationStatus.COMPLETED;
      pending.organizationId = organization.id;
      await manager.save(pending);

      this.logger.log(
        {
          event: 'registration_materialized',
          organizationId: organization.id,
          planSlug: pending.planSlug,
          newIdentity: isNewIdentity,
        },
        `Materialized ${isNewIdentity ? 'a new account' : 'an additional organization'} (org ${organization.id}, plan ${pending.planSlug}).`,
      );
      return user;
    });
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
