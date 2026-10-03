import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataTransferDataset } from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { PERMISSIONS } from '../shared/permissions';
import { VendorBill } from './entities/vendor-bill.entity';

/** Supplier bills, one row each — EXPORT ONLY (QA A-10): a bill is approved and posted, not imported. */
@Injectable()
export class VendorBillsDataTransferProvider implements DataTransferDataset, OnModuleInit {
  readonly id = 'vendor_bills';
  readonly labelKey = 'data_transfer.datasets.vendor_bills';
  readonly viewPermission = PERMISSIONS.ACCOUNTS_PAYABLE_VIEW;
  readonly columns = [
    { key: 'ncf', property: 'ncf' },
    { key: 'proveedor', property: 'vendorName' },
    { key: 'tax_id_proveedor', property: 'vendorTaxId' },
    { key: 'fecha', property: 'date' },
    { key: 'vencimiento', property: 'dueDate' },
    { key: 'moneda', property: 'currencyCode' },
    { key: 'impuesto', property: 'taxAmount' },
    { key: 'total', property: 'total' },
    { key: 'saldo', property: 'balance' },
    { key: 'estado', property: 'status' },
  ] as const;

  constructor(
    private readonly registry: DataTransferRegistry,
    @InjectRepository(VendorBill) private readonly bills: Repository<VendorBill>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async exportPage(organizationId: string, take: number, skip: number) {
    const [bills, total] = await this.bills.findAndCount({
      where: { organizationId },
      relations: { vendor: true },
      order: { date: 'DESC', id: 'ASC' },
      take,
      skip,
    });
    const rows = bills.map((bill) => ({
      ...bill,
      vendorName: bill.vendor?.name ?? null,
      vendorTaxId: bill.vendor?.taxId ?? null,
    }));
    return { rows: rows as unknown as Array<Record<string, unknown>>, total };
  }
}
