
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationSubsidiary } from './entities/organization-subsidiary.entity';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CreateSubsidiaryDto } from './dto/create-subsidiary.dto';
import { AccountSegmentsService } from '../chart-of-accounts/account-segments.service';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(OrganizationSubsidiary)
    private readonly subsidiaryRepository: Repository<OrganizationSubsidiary>,
    private readonly accountSegmentsService: AccountSegmentsService,
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

  async createSubsidiary(parentOrganizationId: string, createSubsidiaryDto: CreateSubsidiaryDto): Promise<OrganizationSubsidiary> {
    return this.organizationRepository.manager.transaction(async (manager) => {
      // 1. Create the new organization for the subsidiary
      const newOrg = manager.create(Organization, {
        legalName: createSubsidiaryDto.legalName,
        taxId: createSubsidiaryDto.taxId,
        country: createSubsidiaryDto.country,
        // Default fields
      });
      const savedOrg = await manager.save(newOrg);

      // 2. Initialize segment definitions
      await this.accountSegmentsService.initializeDefault(savedOrg.id, manager);

      // 3. Create the relationship
      const subsidiary = manager.create(OrganizationSubsidiary, {
        parentOrganizationId: parentOrganizationId,
        subsidiaryOrganizationId: savedOrg.id,
        ownership: createSubsidiaryDto.ownership,
      });

      return manager.save(subsidiary);
    });
  }

  async create(
    createOrganizationDto: Partial<Organization>,
    manager?: EntityManager,
  ): Promise<Organization> {
    if (manager) {
      const org = manager.create(Organization, createOrganizationDto);
      const savedOrg = await manager.save(org);
      await this.accountSegmentsService.initializeDefault(savedOrg.id, manager);
      return savedOrg;
    }

    return this.organizationRepository.manager.transaction(async (m) => {
      const org = m.create(Organization, createOrganizationDto);
      const savedOrg = await m.save(org);
      await this.accountSegmentsService.initializeDefault(savedOrg.id, m);
      return savedOrg;
    });
  }

  async findByTaxId(taxId: string): Promise<Organization | null> {
    return this.organizationRepository.findOneBy({ taxId });
  }
}
