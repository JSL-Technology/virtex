import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DuplicateRecord, DuplicateSourceRegistry } from '../contracts/data-quality/duplicate-sources.contract';
import { PERMISSIONS } from '../shared/permissions';
import { Supplier } from './entities/supplier.entity';

/** Suppliers, offered to the duplicate check. */
@Injectable()
export class SuppliersDuplicatesSource implements OnModuleInit {
  readonly type = 'SUPPLIER' as const;
  readonly viewPermission = PERMISSIONS.SUPPLIERS_VIEW;
  readonly editPermission = PERMISSIONS.SUPPLIERS_EDIT;

  constructor(
    private readonly registry: DuplicateSourceRegistry,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async records(organizationId: string, offset: number, limit: number): Promise<DuplicateRecord[]> {
    const rows = await this.suppliers.find({
      where: { organizationId },
      select: ['id', 'name', 'taxId', 'email', 'phone'],
      order: { id: 'ASC' },
      skip: offset,
      take: limit,
    });
    return rows.map((row) => ({ id: row.id, name: row.name, taxId: row.taxId ?? null, email: row.email ?? null, phone: row.phone ?? null }));
  }

  link(id: string): string {
    return `/contacts/suppliers/${id}/edit`;
  }
}
