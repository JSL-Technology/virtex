
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerGroup } from './entities/customer-group.entity';
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto';
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto';
import { NotFoundError } from '../i18n/localized.exception';
import { assertNotInUse } from '../common/database/dependents';

@Injectable()
export class CustomerGroupsService {
  constructor(
    @InjectRepository(CustomerGroup)
    private readonly customerGroupRepository: Repository<CustomerGroup>,
  ) {}

  create(createDto: CreateCustomerGroupDto, organizationId: string): Promise<CustomerGroup> {
    const group = this.customerGroupRepository.create({ ...createDto, organizationId });
    return this.customerGroupRepository.save(group);
  }

  findAll(organizationId: string): Promise<CustomerGroup[]> {
    return this.customerGroupRepository.find({ where: { organizationId } });
  }

  async findOne(id: string, organizationId: string): Promise<CustomerGroup> {
    const group = await this.customerGroupRepository.findOne({ where: { id, organizationId } });
    if (!group) {
      throw new NotFoundError('customers.customer_group_id_not_found', { id });
    }
    return group;
  }

  async update(id: string, updateDto: UpdateCustomerGroupDto, organizationId: string): Promise<CustomerGroup> {
    const group = await this.findOne(id, organizationId);
    const updatedGroup = this.customerGroupRepository.merge(group, updateDto);
    return this.customerGroupRepository.save(updatedGroup);
  }

  /** A group with members is emptied first: deleting it would leave customers filed nowhere. */
  async remove(id: string, organizationId: string): Promise<void> {
    await this.customerGroupRepository.manager.transaction(async (manager) => {
      const group = await manager.findOne(CustomerGroup, { where: { id, organizationId } });
      if (!group) throw new NotFoundError('customers.customer_group_id_not_found', { id });
      await assertNotInUse(manager, 'customer_groups', id, 'customers.customer_group_in_use');
      await manager.delete(CustomerGroup, { id, organizationId });
    });
  }
}