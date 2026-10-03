
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { Dimension } from './entities/dimension.entity';
import { CreateDimensionDto, UpdateDimensionDto } from './dto/dimension.dto';
import { DimensionValue } from './entities/dimension-value.entity';
import { DimensionRule } from './entities/dimension-rule.entity';
import { CreateDimensionRuleDto } from './dto/dimension-rule.dto';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { ConflictError, NotFoundError } from '../i18n/localized.exception';

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
    if (!dimension) throw new NotFoundError('dimensions.dimension_id_not_found', { id });
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

        if (!dimension) throw new NotFoundError('dimensions.dimension_id_not_found', { id });
        // Posted lines carry dimensions BY NAME (`{"Centro de costo": "Ventas"}`). Renaming a used
        // dimension, or renaming or removing a used value, silently changed what those lines mean:
        // the analytical view pivots on the current names, so the history dropped out of every
        // report. A dimension code is immutable once entries use it — the rule in every ERP with
        // analytic dimensions; unused names and values stay freely editable.
        if (updateDto.name && updateDto.name !== dimension.name) {
          await this.assertDimensionUnused(manager, organizationId, dimension.name);
        }
        if (updateDto.name) dimension.name = updateDto.name;

        if (updateDto.values) {
            const existingValueMap = new Map(dimension.values.map(v => [v.id, v]));
            const updatedValues: DimensionValue[] = [];

            for(const valueDto of updateDto.values) {
                if(valueDto.id && existingValueMap.has(valueDto.id)) {
                    const existingValue = existingValueMap.get(valueDto.id)!;
                    if (existingValue.value !== valueDto.value) {
                      await this.assertValueUnused(manager, organizationId, dimension.name, existingValue.value);
                    }
                    existingValue.value = valueDto.value;
                    updatedValues.push(existingValue);
                    existingValueMap.delete(valueDto.id);
                } else {
                    const newValue = valueRepo.create({ value: valueDto.value, dimension });
                    updatedValues.push(newValue);
                }
            }
            
            const valuesToDelete = Array.from(existingValueMap.values());
            for (const removed of valuesToDelete) {
              await this.assertValueUnused(manager, organizationId, dimension.name, removed.value);
            }
            if (valuesToDelete.length > 0) await valueRepo.remove(valuesToDelete);
            
            dimension.values = updatedValues;
        }
        
        return dimensionRepo.save(dimension);
    });
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const dimension = await manager.findOne(Dimension, { where: { id, organizationId } });
      if (!dimension) throw new NotFoundError('dimensions.dimension_id_not_found', { id });
      await this.assertDimensionUnused(manager, organizationId, dimension.name);
      await manager.delete(Dimension, { id, organizationId });
    });
  }

  /** Refuses when any of the tenant's journal lines is tagged with this dimension. */
  private async assertDimensionUnused(manager: EntityManager, organizationId: string, name: string): Promise<void> {
    const [{ count }] = await manager.query(
      `SELECT COUNT(*)::int AS count
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.organization_id = $1 AND l.dimensions ? $2`,
      [organizationId, name],
    );
    if (count > 0) throw new ConflictError('dimensions.dimension_in_use', { name, count });
  }

  /** Refuses when any of the tenant's journal lines carries this value of the dimension. */
  private async assertValueUnused(
    manager: EntityManager,
    organizationId: string,
    name: string,
    value: string,
  ): Promise<void> {
    const [{ count }] = await manager.query(
      `SELECT COUNT(*)::int AS count
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.organization_id = $1 AND l.dimensions ->> $2 = $3`,
      [organizationId, name, value],
    );
    if (count > 0) throw new ConflictError('dimensions.dimension_value_in_use', { name, value, count });
  }
  
  async getRulesForAccount(accountId: string, organizationId: string): Promise<DimensionRule[]> {
      const account = await this.dataSource.getRepository(Account).findOneBy({ id: accountId, organizationId });
      if (!account) throw new NotFoundError('dimensions.account_account_id_not_found', { accountId });
      
      return this.dimensionRuleRepository.find({ where: { accountId }, relations: ['dimension'] });
  }

  async createRule(dto: CreateDimensionRuleDto, organizationId: string): Promise<DimensionRule> {
      const { accountId, dimensionId } = dto;

      const [account, dimension] = await Promise.all([
          this.dataSource.getRepository(Account).findOneBy({ id: accountId, organizationId }),
          this.dimensionRepository.findOneBy({ id: dimensionId, organizationId }),
      ]);

      if (!account) throw new NotFoundError('dimensions.account_account_id_not_found_your', { accountId });
      if (!dimension) throw new NotFoundError('dimensions.dimension_dimension_id_not_found_your', { dimensionId });
      
      const rule = this.dimensionRuleRepository.create({ ...dto, isRequired: true });
      return this.dimensionRuleRepository.save(rule);
  }

  async deleteRule(accountId: string, dimensionId: string, organizationId: string): Promise<void> {
      const rule = await this.dimensionRuleRepository.findOne({
          where: { accountId, dimensionId },
          relations: ['account']
      });

      if (!rule || rule.account.organizationId !== organizationId) {
          throw new NotFoundError('dimensions.specified_dimension_rule_not_found');
      }
      
      await this.dimensionRuleRepository.remove(rule);
  }
}