import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataTransferContext, DataTransferDataset } from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { PERMISSIONS } from '../shared/permissions';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';
import { InventoryService } from './inventory.service';

/**
 * Products, for export and import (QA A-10).
 *
 * Imported through `InventoryService.create`, so an opening stock is VALUED and posted (Dr
 * Inventory / Cr opening balance) exactly as when it is typed in the form — an import that set
 * quantities without the entry would leave stock the ledger does not know about. The tax rate is
 * the form's: a fraction (0.18), refused above 1 (QA M-04/M-05).
 */
@Injectable()
export class ProductsDataTransferProvider implements DataTransferDataset<CreateProductDto>, OnModuleInit {
  readonly id = 'products';
  readonly labelKey = 'data_transfer.datasets.products';
  readonly viewPermission = PERMISSIONS.PRODUCTS_VIEW;
  readonly columns = [
    { key: 'sku', property: 'sku', example: 'LAP-001' },
    { key: 'nombre', property: 'name', required: true, example: 'Laptop 14"' },
    { key: 'descripcion', property: 'description', example: 'Laptop de oficina, 16 GB' },
    { key: 'tipo', property: 'kind', example: 'GOOD' },
    { key: 'unidad', property: 'unitOfMeasure', example: 'UND' },
    { key: 'precio', property: 'price', required: true, example: '45000' },
    { key: 'costo', property: 'cost', example: '32000' },
    { key: 'existencia', property: 'stock', required: true, example: '10' },
    { key: 'punto_reorden', property: 'reorderLevel', example: '2' },
    { key: 'tratamiento_impuesto', property: 'taxTreatment', example: 'TAXED' },
    { key: 'tasa_impuesto', property: 'taxRate', example: '0.18' },
    { key: 'estado', property: 'status', example: 'ACTIVE' },
  ] as const;

  readonly import = {
    createPermission: PERMISSIONS.PRODUCTS_CREATE,
    dto: CreateProductDto,
    uniqueBy: 'sku',
    exists: async (value: string, context: DataTransferContext) =>
      (await this.products.count({ where: { organizationId: context.organizationId, sku: value } })) > 0,
    create: async (dto: CreateProductDto, context: DataTransferContext) => {
      await this.service.create(dto, context.organizationId, context.userId);
    },
  };

  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly service: InventoryService,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this as DataTransferDataset);
  }

  async exportPage(organizationId: string, take: number, skip: number) {
    const [rows, total] = await this.products.findAndCount({
      where: { organizationId },
      order: { name: 'ASC', id: 'ASC' },
      take,
      skip,
    });
    return { rows: rows as unknown as Array<Record<string, unknown>>, total };
  }
}
