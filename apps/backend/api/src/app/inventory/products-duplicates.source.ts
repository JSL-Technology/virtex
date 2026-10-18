import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DuplicateRecord, DuplicateSourceRegistry } from '../contracts/data-quality/duplicate-sources.contract';
import { PERMISSIONS } from '../shared/permissions';
import { Product, ProductStatus } from './entities/product.entity';

/** Active products, offered to the duplicate check (by name, SKU and barcode). */
@Injectable()
export class ProductsDuplicatesSource implements OnModuleInit {
  readonly type = 'PRODUCT' as const;
  readonly viewPermission = PERMISSIONS.PRODUCTS_VIEW;
  readonly editPermission = PERMISSIONS.PRODUCTS_EDIT;

  constructor(
    private readonly registry: DuplicateSourceRegistry,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async records(organizationId: string, offset: number, limit: number): Promise<DuplicateRecord[]> {
    const rows = await this.products.find({
      where: { organizationId, status: ProductStatus.ACTIVE },
      select: ['id', 'name', 'sku', 'barcode'],
      order: { id: 'ASC' },
      skip: offset,
      take: limit,
    });
    return rows.map((row) => ({ id: row.id, name: row.name, code: row.sku ?? null, barcode: row.barcode ?? null }));
  }

  link(id: string): string {
    return `/inventory/products/${id}/edit`;
  }
}
