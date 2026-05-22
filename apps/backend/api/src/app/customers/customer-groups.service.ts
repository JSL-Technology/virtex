
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerGroup } from './entities/customer-group.entity';
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto';
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto';

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
      throw new NotFoundException(`Grupo de clientes con ID "${id}" no encontrado.`);
    }
    return group;
  }

  async update(id: string, updateDto: UpdateCustomerGroupDto, organizationId: string): Promise<CustomerGroup> {
    const group = await this.findOne(id, organizationId);
    const updatedGroup = this.customerGroupRepository.merge(group, updateDto);
    return this.customerGroupRepository.save(updatedGroup);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.customerGroupRepository.delete({ id, organizationId });
    if (result.affected === 0) {
      throw new NotFoundException(`Grupo de clientes con ID "${id}" no encontrado.`);
    }
  }
}