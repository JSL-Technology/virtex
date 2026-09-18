import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { OrganizationCreatedEvent } from '../accounting/handlers/organization-provisioning.handler';
import { Organization } from './entities/organization.entity';
import { OrganizationSubsidiary } from './entities/organization-subsidiary.entity';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CreateSubsidiaryDto } from './dto/create-subsidiary.dto';
import { AccountSegmentsService } from '../chart-of-accounts/account-segments.service';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { LocalizationProvisioningPort } from '../localization/localization-provisioning.port';
import { MembershipService } from './services/membership.service';
import { coaSegmentsFor } from '../localization/fiscal/coa-builder';
import { findCountryProfile } from '../localization/fiscal/country-profiles';
import { TaxpayerKind } from '../localization/fiscal/tax-id-validators';
import {
  canonicalizeTaxId,
  fiscalIdentifierLabel,
  validateTaxId,
} from '../localization/fiscal/identity-document-catalogue';
import { organizationTimeZone } from '../shared/fiscal-clock';
import { BadRequestError, ConflictError, InternalServerError, NotFoundError } from '../i18n/localized.exception';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(OrganizationSubsidiary)
    private readonly subsidiaryRepository: Repository<OrganizationSubsidiary>,
    private readonly accountSegmentsService: AccountSegmentsService,
    private readonly saasService: SaasService,
    private readonly localizationService: LocalizationProvisioningPort,
    private readonly membershipService: MembershipService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findOne(id: string): Promise<Organization> {
    const organization = await this.organizationRepository.findOneBy({ id });
    if (!organization) {
      throw new NotFoundError('organizations.organization_with_id_not_found', { id });
    }
    return organization;
  }

  /**
   * Edit the tenant's own profile, re-validating its fiscal identity when it moves.
   *
   * The `taxId` on this row is the emisor of every electronic comprobante the product signs, and
   * `ecf-validator.service.ts` and the six regime builders read it from here. The old
   * implementation was a bare `Object.assign` with no check, so any string could overwrite it after
   * registration — the same hole the audit found in customers and suppliers, surviving in the
   * tenant. Registration (`profile-registration.strategy.ts`) and subsidiary creation
   * (`createSubsidiary` below) both validate the identifier arithmetically with the taxpayer kind;
   * this is the third door into the same column and now applies the same rule.
   */
  async update(id: string, updateOrganizationDto: UpdateOrganizationDto): Promise<Organization> {
    const organization = await this.findOne(id);

    const previousCountry = (organization.country ?? '').trim().toUpperCase();
    const nextCountry =
      updateOrganizationDto.country !== undefined
        ? (updateOrganizationDto.country ?? '').trim().toUpperCase()
        : previousCountry;

    // A provisioned tenant's country is fixed. Its fiscal region, chart of accounts, taxes and
    // document sequences were all created for one jurisdiction, and letting a profile edit change
    // it would leave every one of them pointing at the wrong country while future comprobantes kept
    // numbering under the old regime. Setting a country that was never recorded — legacy rows
    // carried null — is a correction and stays allowed.
    if (previousCountry && nextCountry !== previousCountry && organization.fiscalRegionId) {
      throw new BadRequestError('organizations.country_cannot_change_after_provisioning', {
        current: previousCountry,
      });
    }

    // The tax id and the country decide validity together — an RNC is not a RUT — so a change to
    // either re-runs the check. A change to neither leaves a stored identifier untouched, so an
    // edit to the logo or the phone does not force the tenant to re-confirm it.
    const identityTouched =
      updateOrganizationDto.taxId !== undefined || updateOrganizationDto.country !== undefined;

    Object.assign(organization, updateOrganizationDto);

    if (identityTouched) {
      const country = (organization.country ?? '').trim().toUpperCase();
      const profile = findCountryProfile(country);
      if (!profile) {
        throw new BadRequestError('organizations.country_country_not_available_yet', {
          country: organization.country ?? '',
        });
      }
      if (!organization.taxId?.trim()) {
        throw new BadRequestError('organizations.label_required_name', {
          label: fiscalIdentifierLabel(country),
          name: profile.name,
        });
      }
      // The taxpayer kind selects the scheme, exactly as at registration: a US nine-digit value is
      // a valid EIN under one prefix rule and an SSN under another, and only the kind decides which.
      const kind =
        organization.taxpayerKind === TaxpayerKind.COMPANY
          ? TaxpayerKind.COMPANY
          : organization.taxpayerKind === TaxpayerKind.INDIVIDUAL
            ? TaxpayerKind.INDIVIDUAL
            : undefined;
      if (!validateTaxId(country, organization.taxId, kind)) {
        throw new BadRequestError('organizations.label_not_valid_name', {
          label: fiscalIdentifierLabel(country),
          name: profile.name,
        });
      }
      // Store the canonical form and mark it verified, exactly as the other two doors do. The unique
      // index on (tax_id, fiscal_region_id) compares the canonical value, so `900123456-8` and
      // `9001234568` are the same tenant rather than two.
      organization.taxId = canonicalizeTaxId(country, organization.taxId);
      organization.taxIdVerifiedAt = new Date();
    }

    return this.organizationRepository.save(organization);
  }

  async getSubsidiaries(organizationId: string): Promise<OrganizationSubsidiary[]> {
    return this.subsidiaryRepository.find({
      where: { parentOrganizationId: organizationId },
      relations: ['subsidiary'],
    });
  }

  /**
   * Create a subsidiary that is a usable tenant from the moment it exists.
   *
   * It previously created an `Organization` carrying a legal name, a tax id and a country and
   * nothing else — no fiscal region, no chart of accounts, no taxes, no plan, no subscription
   * status and no membership. With entitlement enforced globally, that tenant refused every
   * request it ever received; and with no `user_organizations` row, nobody could switch into it
   * to find out. It was a write-only record.
   *
   * A subsidiary is a second set of books under the same commercial relationship, so:
   *   - its fiscal identity is validated and canonicalised exactly like a signup's,
   *   - it receives the country's chart of accounts and taxes in the same transaction,
   *   - it inherits the parent's plan and subscription — it is not billed separately, and
   *     inheriting is what stops `SubscriptionActiveGuard` from refusing every request,
   *   - the person who created it becomes a member, so they can actually switch to it.
   */
  async createSubsidiary(
    parentOrganizationId: string,
    createSubsidiaryDto: CreateSubsidiaryDto,
    createdByUserId: string,
  ): Promise<OrganizationSubsidiary> {
    const country = createSubsidiaryDto.country?.toUpperCase() ?? '';
    const profile = findCountryProfile(country);
    if (!profile) {
      throw new BadRequestError('organizations.country_country_not_available_yet', { country: createSubsidiaryDto.country });
    }
    if (!validateTaxId(country, createSubsidiaryDto.taxId)) {
      throw new BadRequestError('organizations.label_not_valid_name', { label: fiscalIdentifierLabel(country), name: profile.name });
    }

    const taxId = canonicalizeTaxId(country, createSubsidiaryDto.taxId);
    const region = await this.localizationService.findRegionByCountryCode(country);
    if (!region) {
      throw new InternalServerError('organizations.tax_configuration_country_not_available_right');
    }

    return this.organizationRepository.manager.transaction(async (manager) => {
      // Group consolidation is an enterprise capability, and every subsidiary is a second set of
      // books. Unmetered, a starter plan could carry an unlimited group structure.
      await this.saasService.enforceLimit(
        manager,
        parentOrganizationId,
        SaasResource.SUBSIDIARIES,
      );

      const parent = await manager.findOne(Organization, {
        where: { id: parentOrganizationId },
      });
      if (!parent) {
        throw new NotFoundError('organizations.parent_organization_not_found');
      }

      // Same rule the signup applies: one fiscal identity per market.
      const duplicate = await manager.findOne(Organization, {
        where: { taxId, fiscalRegionId: region.id },
      });
      if (duplicate) {
        throw new ConflictError('organizations.organization_already_registered_with_label', { label: fiscalIdentifierLabel(country) });
      }

      const savedOrg = await this.create(
        {
          legalName: createSubsidiaryDto.legalName,
          taxId,
          country,
          fiscalRegionId: region.id,
          taxIdVerifiedAt: new Date(),
          // Billed through the parent. Copied rather than left null because the entitlement guard
          // reads these fields on every request the subsidiary serves.
          planId: parent.planId,
          subscriptionStatus: parent.subscriptionStatus,
          subscriptionPeriodEnd: parent.subscriptionPeriodEnd,
          gracePeriodEnd: parent.gracePeriodEnd,
          externalCustomerId: parent.externalCustomerId,
          externalSubscriptionId: parent.externalSubscriptionId,
          timezone: parent.timezone,
        },
        manager,
      );

      // Chart of accounts and taxes, in the same transaction that created the books they belong
      // to. A subsidiary without them is exactly the empty tenant a signup used to produce.
      await this.localizationService.applyFiscalPackage(savedOrg, manager);

      // Without this the creator cannot switch into the tenant they just created:
      // `resolveOrganizationContext` validates the target against `user_organizations`.
      await this.membershipService.grant(createdByUserId, savedOrg.id, manager);

      const subsidiary = manager.create(OrganizationSubsidiary, {
        parentOrganizationId: parentOrganizationId,
        subsidiaryOrganizationId: savedOrg.id,
        ownership: createSubsidiaryDto.ownership,
      });

      return manager.save(subsidiary);
    });
  }

  /**
   * Create an organization together with the account-code structure its chart of accounts needs.
   *
   * The structure is derived from the country — `coaSegmentsFor` is declared beside the country's
   * chart-of-accounts template — rather than from a fixed 1-2-2-3 default that no template could
   * satisfy. See `AccountSegmentsService.initializeDefault`.
   */
  async create(
    createOrganizationDto: Partial<Organization>,
    manager?: EntityManager,
  ): Promise<Organization> {
    const segments = coaSegmentsFor(createOrganizationDto.country ?? '');

    // The column defaulted to 'UTC' and nothing ever wrote it, so every tenant in every market
    // looked like it kept books in UTC — and every fiscal timestamp was produced accordingly. Santo
    // Domingo is four hours behind it: a sale made at 20:30 was dated the following day. The zone
    // is part of creating the tenant, not something an operator has to remember to set.
    const attributes: Partial<Organization> = {
      ...createOrganizationDto,
      timezone:
        createOrganizationDto.timezone && createOrganizationDto.timezone !== 'UTC'
          ? createOrganizationDto.timezone
          : organizationTimeZone({ country: createOrganizationDto.country ?? null }),
    };

    const save = async (m: EntityManager): Promise<Organization> => {
      const org = m.create(Organization, attributes);
      const savedOrg = await m.save(org);
      await this.accountSegmentsService.initializeDefault(savedOrg.id, m, segments);
      return savedOrg;
    };

    const savedOrg = manager
      ? await save(manager)
      : await this.organizationRepository.manager.transaction(save);

    // Post-commit: modules that need to set up per-org state (bookkeeping, locale defaults)
    // listen to this event instead of being called directly from here. The provisioning is
    // non-transactional by design — if it fails the org still exists and can be re-provisioned
    // from the settings screen.
    const event: OrganizationCreatedEvent = {
      organizationId: savedOrg.id,
      country: savedOrg.country ?? '',
    };
    this.eventEmitter.emit('organization.created', event);

    return savedOrg;
  }

  async findByTaxId(taxId: string): Promise<Organization | null> {
    return this.organizationRepository.findOneBy({ taxId });
  }
}
