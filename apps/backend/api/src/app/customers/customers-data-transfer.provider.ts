import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DataTransferContext, DataTransferDataset } from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { partyTemplateExample } from '../contracts/data-transfer/party-template-example';
import { PERMISSIONS } from '../shared/permissions';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { Customer } from './entities/customer.entity';

/**
 * Customers, for export and import (QA A-10). Imported rows go through `CreateCustomerDto` and
 * `CustomersService.create`, so they meet the form's rules: tax-id check digit and document type,
 * the plan's customer limit, and per-tenant uniqueness of the tax id.
 *
 * The column keys are the same public contract DataSheets already uses (`nombre`, `tax_id`,
 * `correo`…), so a sheet downloaded from one opens in the other.
 */
@Injectable()
export class CustomersDataTransferProvider implements DataTransferDataset<CreateCustomerDto>, OnModuleInit {
  readonly id = 'customers';
  readonly labelKey = 'data_transfer.datasets.customers';
  readonly viewPermission = PERMISSIONS.CUSTOMERS_VIEW;
  readonly columns = [
    // The identifier, its document code and the country come from the company's own market
    // (`templateExample`); what is left here is a neutral placeholder, not another market's data.
    { key: 'nombre', property: 'companyName', required: true, example: 'Comercial Ejemplo SRL' },
    { key: 'tax_id', property: 'taxId' },
    { key: 'tipo_documento', property: 'identityDocumentTypeCode' },
    { key: 'pais_documento', property: 'identityDocumentCountry' },
    { key: 'tipo_contribuyente', property: 'taxpayerType', example: 'LEGAL_ENTITY' },
    { key: 'contacto', property: 'contactPerson', example: 'Ana Pérez' },
    { key: 'correo', property: 'email', example: 'compras@ejemplo.test' },
    { key: 'telefono', property: 'phone' },
    { key: 'direccion', property: 'address', example: 'Calle Principal 100' },
    { key: 'ciudad', property: 'city' },
    { key: 'provincia', property: 'stateOrProvince' },
    { key: 'codigo_postal', property: 'postalCode' },
    { key: 'pais', property: 'country', required: true },
    { key: 'dias_credito', property: 'paymentTermDays', example: '30' },
  ] as const;

  readonly import = {
    createPermission: PERMISSIONS.CUSTOMERS_CREATE,
    dto: CreateCustomerDto,
    uniqueBy: 'tax_id',
    exists: async (value: string, context: DataTransferContext) =>
      (await this.customers.count({ where: { organizationId: context.organizationId, taxId: value } })) > 0,
    check: (dto: CreateCustomerDto, context: DataTransferContext) =>
      this.service.assertImportable(dto, context.organizationId),
    create: async (dto: CreateCustomerDto, context: DataTransferContext) => {
      await this.service.create(dto, context.organizationId);
    },
    templateExample: (context: DataTransferContext) => partyTemplateExample(this.dataSource, context.organizationId),
  };

  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly service: CustomersService,
    private readonly dataSource: DataSource,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this as DataTransferDataset);
  }

  async exportPage(organizationId: string, take: number, skip: number) {
    const [rows, total] = await this.customers.findAndCount({
      where: { organizationId },
      order: { companyName: 'ASC', id: 'ASC' },
      take,
      skip,
    });
    return { rows: rows as unknown as Array<Record<string, unknown>>, total };
  }
}
