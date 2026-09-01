import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationSubsidiary } from './entities/organization-subsidiary.entity';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CreateSubsidiaryDto } from './dto/create-subsidiary.dto';
import { AccountSegmentsService } from '../chart-of-accounts/account-segments.service';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { LocalizationService } from '../localization/services/localization.service';
import { MembershipService } from './services/membership.service';
import { coaSegmentsFor } from '../localization/fiscal/coa-builder';
import { findCountryProfile } from '../localization/fiscal/country-profiles';
import { canonicalizeTaxId, validateTaxId } from '../localization/fiscal/tax-id-validators';
import { organizationTimeZone } from '../shared/fiscal-clock';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(OrganizationSubsidiary)
    private readonly subsidiaryRepository: Repository<OrganizationSubsidiary>,
    private readonly accountSegmentsService: AccountSegmentsService,
    private readonly saasService: SaasService,
    private readonly localizationService: LocalizationService,
    private readonly membershipService: MembershipService,
  ) {}

  async findOne(id: string): Promise<Organization> {
    const organization = await this.organizationRepository.findOneBy({ id });
    if (!organization) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }
    return organization;
  }

  async update(id: string, updateOrganizationDto: UpdateOrganizationDto): Promise<Organization> {
    const organization = await this.findOne(id);
    Object.assign(organization, updateOrganizationDto);
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
      throw new BadRequestException(
        `El país "${createSubsidiaryDto.country}" todavía no está disponible.`,
      );
    }
    if (!validateTaxId(country, createSubsidiaryDto.taxId)) {
      throw new BadRequestException(
        `El ${profile.taxId.label} no es válido para ${profile.name}.`,
      );
    }

    const taxId = canonicalizeTaxId(country, createSubsidiaryDto.taxId);
    const region = await this.localizationService.findRegionByCountryCode(country);
    if (!region) {
      throw new InternalServerErrorException(
        'La configuración fiscal de ese país no está disponible en este momento.',
      );
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
        throw new NotFoundException('Organización matriz no encontrada.');
      }

      // Same rule the signup applies: one fiscal identity per market.
      const duplicate = await manager.findOne(Organization, {
        where: { taxId, fiscalRegionId: region.id },
      });
      if (duplicate) {
        throw new ConflictException(
          `Ya existe una organización registrada con ese ${profile.taxId.label}.`,
        );
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

    if (manager) {
      const org = manager.create(Organization, attributes);
      const savedOrg = await manager.save(org);
      await this.accountSegmentsService.initializeDefault(savedOrg.id, manager, segments);
      return savedOrg;
    }

    return this.organizationRepository.manager.transaction(async (m) => {
      const org = m.create(Organization, attributes);
      const savedOrg = await m.save(org);
      await this.accountSegmentsService.initializeDefault(savedOrg.id, m, segments);
      return savedOrg;
    });
  }

  async findByTaxId(taxId: string): Promise<Organization | null> {
    return this.organizationRepository.findOneBy({ taxId });
  }
}
