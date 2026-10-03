import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataTransferContext, DataTransferDataset } from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { PERMISSIONS } from '../shared/permissions';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { Supplier } from './entities/supplier.entity';
import { SuppliersService } from './suppliers.service';

/**
 * Suppliers, for export and import (QA A-10), through `CreateSupplierDto` and
 * `SuppliersService.create` — the same rules as the form, including the fiscal identifier a 606
 * line needs (B-02: a bill from a supplier with no RNC reached the 606).
 */
@Injectable()
export class SuppliersDataTransferProvider implements DataTransferDataset<CreateSupplierDto>, OnModuleInit {
  readonly id = 'suppliers';
  readonly labelKey = 'data_transfer.datasets.suppliers';
  readonly viewPermission = PERMISSIONS.SUPPLIERS_VIEW;
  readonly columns = [
    { key: 'nombre', property: 'name', required: true, example: 'Distribuidora Nacional SRL' },
    { key: 'tax_id', property: 'taxId', example: '101-00000-1' },
    { key: 'tipo_documento', property: 'identityDocumentTypeCode', example: 'RNC' },
    { key: 'pais_documento', property: 'identityDocumentCountry', example: 'DO' },
    { key: 'tipo_contribuyente', property: 'taxpayerType', example: 'LEGAL_ENTITY' },
    { key: 'contacto', property: 'contactPerson', example: 'Luis Gómez' },
    { key: 'correo', property: 'email', example: 'ventas@distribuidora.do' },
    { key: 'telefono', property: 'phone', example: '+1 809 555 0200' },
    { key: 'direccion', property: 'address', example: 'Calle 5 #12, Santiago' },
    { key: 'pais', property: 'country', example: 'DO' },
  ] as const;

  readonly import = {
    createPermission: PERMISSIONS.SUPPLIERS_CREATE,
    dto: CreateSupplierDto,
    uniqueBy: 'tax_id',
    exists: async (value: string, context: DataTransferContext) =>
      (await this.suppliers.count({ where: { organizationId: context.organizationId, taxId: value } })) > 0,
    check: (dto: CreateSupplierDto, context: DataTransferContext) =>
      this.service.assertImportable(dto, context.organizationId),
    create: async (dto: CreateSupplierDto, context: DataTransferContext) => {
      await this.service.create(dto, context.organizationId);
    },
  };

  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly service: SuppliersService,
    @InjectRepository(Supplier) private readonly suppliers: Repository<Supplier>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this as DataTransferDataset);
  }

  async exportPage(organizationId: string, take: number, skip: number) {
    const [rows, total] = await this.suppliers.findAndCount({
      where: { organizationId },
      order: { name: 'ASC', id: 'ASC' },
      take,
      skip,
    });
    return { rows: rows as unknown as Array<Record<string, unknown>>, total };
  }
}
