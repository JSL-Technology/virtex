import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { DuplicateRecord, DuplicateSourceRegistry } from '../contracts/data-quality/duplicate-sources.contract';
import { PERMISSIONS } from '../shared/permissions';
import { Customer, CustomerStatus } from './entities/customer.entity';

/** Customers, offered to the duplicate check: every one not set inactive. */
@Injectable()
export class CustomersDuplicatesSource implements OnModuleInit {
  readonly type = 'CUSTOMER' as const;
  readonly viewPermission = PERMISSIONS.CUSTOMERS_VIEW;
  readonly editPermission = PERMISSIONS.CUSTOMERS_EDIT;

  constructor(
    private readonly registry: DuplicateSourceRegistry,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async records(organizationId: string, offset: number, limit: number): Promise<DuplicateRecord[]> {
    const rows = await this.customers.find({
      where: { organizationId, status: Not(CustomerStatus.INACTIVE) },
      select: ['id', 'companyName', 'taxId', 'email', 'phone'],
      order: { id: 'ASC' },
      skip: offset,
      take: limit,
    });
    return rows.map((row) => ({ id: row.id, name: row.companyName, taxId: row.taxId ?? null, email: row.email, phone: row.phone }));
  }

  link(id: string): string {
    return `/contacts/customers/${id}/edit`;
  }
}
