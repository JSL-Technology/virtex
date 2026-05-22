
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Dimension } from './entities/dimension.entity';
import { CreateDimensionDto, UpdateDimensionDto } from './dto/dimension.dto';
import { DimensionValue } from './entities/dimension-value.entity';
import { DimensionRule } from './entities/dimension-rule.entity';
import { CreateDimensionRuleDto } from './dto/dimension-rule.dto';
import { Account } from '../chart-of-accounts/entities/account.entity';

@Injectable()
export class DimensionsService {
  constructor(
    @InjectRepository(Dimension)
    private readonly dimensionRepository: Repository<Dimension>,
    @InjectRepository(DimensionRule)
    private readonly dimensionRuleRepository: Repository<DimensionRule>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(organizationId: string): Promise<Dimension[]> {
    return this.dimensionRepository.find({
      where: { organizationId },
      relations: ['values'],
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<Dimension> {
    const dimension = await this.dimensionRepository.findOne({
      where: { id, organizationId },
      relations: ['values'],
    });
    if (!dimension) throw new NotFoundException(`Dimensión con ID "${id}" no encontrada.`);
    return dimension;
  }

  async create(createDto: CreateDimensionDto, organizationId: string): Promise<Dimension> {
    const dimension = this.dimensionRepository.create({
        ...createDto,
        organizationId,
        values: createDto.values.map(v => this.dataSource.manager.create(DimensionValue, v)),
    });
    return this.dimensionRepository.save(dimension);
  }

  async update(id: string, updateDto: UpdateDimensionDto, organizationId: string): Promise<Dimension> {
    return this.dataSource.transaction(async manager => {
        const dimensionRepo = manager.getRepository(Dimension);
        const valueRepo = manager.getRepository(DimensionValue);

        const dimension = await dimensionRepo.findOne({
            where: { id, organizationId },
            relations: ['values'],
        });

        if (!dimension) throw new NotFoundException(`Dimensión con ID "${id}" no encontrada.`);
        if (updateDto.name) dimension.name = updateDto.name;

        if (updateDto.values) {
            const existingValueMap = new Map(dimension.values.map(v => [v.id, v]));
            const updatedValues: DimensionValue[] = [];

            for(const valueDto of updateDto.values) {
                if(valueDto.id && existingValueMap.has(valueDto.id)) {
                    const existingValue = existingValueMap.get(valueDto.id)!;
                    existingValue.value = valueDto.value;
                    updatedValues.push(existingValue);
                    existingValueMap.delete(valueDto.id);
                } else {
                    const newValue = valueRepo.create({ value: valueDto.value, dimension });
                    updatedValues.push(newValue);
                }
            }
            
            const valuesToDelete = Array.from(existingValueMap.values());
            if (valuesToDelete.length > 0) await valueRepo.remove(valuesToDelete);
            
            dimension.values = updatedValues;
        }
        
        return dimensionRepo.save(dimension);
    });
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.dimensionRepository.delete({ id, organizationId });
    if (result.affected === 0) throw new NotFoundException(`Dimensión con ID "${id}" no encontrada.`);
  }
  
  async getRulesForAccount(accountId: string, organizationId: string): Promise<DimensionRule[]> {
      const account = await this.dataSource.getRepository(Account).findOneBy({ id: accountId, organizationId });
      if (!account) throw new NotFoundException(`Cuenta con ID "${accountId}" no encontrada.`);
      
      return this.dimensionRuleRepository.find({ where: { accountId }, relations: ['dimension'] });
  }

  async createRule(dto: CreateDimensionRuleDto, organizationId: string): Promise<DimensionRule> {
      const { accountId, dimensionId } = dto;

      const [account, dimension] = await Promise.all([
          this.dataSource.getRepository(Account).findOneBy({ id: accountId, organizationId }),
          this.dimensionRepository.findOneBy({ id: dimensionId, organizationId }),
      ]);

      if (!account) throw new NotFoundException(`Cuenta con ID "${accountId}" no encontrada en su organización.`);
      if (!dimension) throw new NotFoundException(`Dimensión con ID "${dimensionId}" no encontrada en su organización.`);
      
      const rule = this.dimensionRuleRepository.create({ ...dto, isRequired: true });
      return this.dimensionRuleRepository.save(rule);
  }

  async deleteRule(accountId: string, dimensionId: string, organizationId: string): Promise<void> {
      const rule = await this.dimensionRuleRepository.findOne({
          where: { accountId, dimensionId },
          relations: ['account']
      });

      if (!rule || rule.account.organizationId !== organizationId) {
          throw new NotFoundException('La regla de dimensión especificada no fue encontrada.');
      }
      
      await this.dimensionRuleRepository.remove(rule);
  }
}