
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { DataSource } from 'typeorm';
import { SaasService } from '../saas/saas.service';
import { SaasResource } from '../saas/enums/saas-resource.enum';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly saasService: SaasService,
  ) {}

  /**
   * Create a customer, against the tenant's plan.
   *
   * Metered in the same transaction as the insert. Counting outside it lets a rolled-back create
   * still consume quota, and counting after it lets a burst of concurrent requests all observe the
   * same pre-increment total and all proceed.
   */
  async create(
    createCustomerDto: CreateCustomerDto,
    organizationId: string,
  ): Promise<Customer> {
    return this.dataSource.transaction(async (manager) => {
      await this.saasService.enforceLimit(manager, organizationId, SaasResource.CUSTOMERS);

      const customer = manager.create(Customer, {
        ...createCustomerDto,
        organizationId,
      });
      return manager.save(customer);
    });
  }

  findAll(organizationId: string): Promise<Customer[]> {
    return this.customerRepository.find({
      where: { organizationId },
      order: { companyName: 'ASC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<Customer> {
    const customer = await this.customerRepository.findOne({
      where: { id, organizationId },
    });
    if (!customer) {
      throw new NotFoundException(`Cliente con ID "${id}" no encontrado.`);
    }
    return customer;
  }

  async update(
    id: string,
    updateCustomerDto: UpdateCustomerDto,
    organizationId: string,
  ): Promise<Customer> {
    const customer = await this.findOne(id, organizationId);
    const updatedCustomer = this.customerRepository.merge(
      customer,
      updateCustomerDto,
    );
    return this.customerRepository.save(updatedCustomer);
  }

  /**
   * Delete a customer, and give the seat of quota back.
   *
   * `CUSTOMERS` is a LIFETIME quota, so without the release it counted "customers ever created"
   * rather than "customers that exist" — a tenant at its limit could delete every record it had
   * and still be unable to create one. Both happen in the same transaction, so a failed delete
   * cannot hand out free quota.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    const customer = await this.findOne(id, organizationId);
    await this.dataSource.transaction(async (manager) => {
      await manager.remove(Customer, customer);
      await this.saasService.releaseUsage(manager, organizationId, SaasResource.CUSTOMERS);
    });
  }
}