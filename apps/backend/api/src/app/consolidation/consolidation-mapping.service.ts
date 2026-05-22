
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsolidationMap } from './entities/consolidation-map.entity';
import { CreateConsolidationMapDto } from './dto/create-consolidation-map.dto';
import { Organization } from '../organizations/entities/organization.entity';

@Injectable()
export class ConsolidationMappingService {
  constructor(
    @InjectRepository(ConsolidationMap)
    private readonly mapRepository: Repository<ConsolidationMap>,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
  ) {}

  async getMapForSubsidiary(parentOrganizationId: string, subsidiaryOrganizationId: string) {
    return this.mapRepository.find({
      where: { parentOrganizationId, subsidiaryOrganizationId },
      relations: ['subsidiaryAccount', 'parentAccount'],
    });
  }

  async createOrUpdateMap(parentOrganizationId: string, dto: CreateConsolidationMapDto) {
    const { subsidiaryOrganizationId, mappings } = dto;


    const parentOrg = await this.orgRepository.findOneBy({ id: parentOrganizationId });
    const subOrg = await this.orgRepository.findOneBy({ id: subsidiaryOrganizationId });
    if (!parentOrg || !subOrg) throw new NotFoundException('Organización no encontrada.');

    await this.mapRepository.delete({ parentOrganizationId, subsidiaryOrganizationId });

    const newMappings = mappings.map(m => this.mapRepository.create({
      parentOrganizationId,
      subsidiaryOrganizationId,
      subsidiaryAccountId: m.subsidiaryAccountId,
      parentAccountId: m.parentAccountId,
    }));

    await this.mapRepository.save(newMappings);
    return { message: `Mapeo para ${subOrg.legalName} actualizado con ${newMappings.length} correspondencias.` };
  }
}