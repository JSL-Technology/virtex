import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataTransferDataset } from '../contracts/data-transfer/data-transfer.contract';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { PERMISSIONS } from '../shared/permissions';
import { PosSale } from './entities/pos-sale.entity';

/**
 * Point-of-sale sales, one row each — EXPORT ONLY (QA A-13: «Exportar» in the sales history did
 * nothing). A till sale is rung up at the till, never created from a spreadsheet.
 */
@Injectable()
export class PosSalesDataTransferProvider implements DataTransferDataset, OnModuleInit {
  readonly id = 'pos_sales';
  readonly labelKey = 'data_transfer.datasets.pos_sales';
  readonly viewPermission = PERMISSIONS.POS_VIEW;
  readonly columns = [
    { key: 'fecha', property: 'createdAt' },
    { key: 'venta', property: 'id' },
    { key: 'terminal', property: 'terminalId' },
    { key: 'cliente', property: 'customerName' },
    { key: 'articulos', property: 'itemCount' },
    { key: 'subtotal', property: 'subtotal' },
    { key: 'impuesto', property: 'tax' },
    { key: 'total', property: 'total' },
    { key: 'metodo_pago', property: 'paymentMethod' },
    { key: 'estado', property: 'status' },
  ] as const;

  constructor(
    private readonly registry: DataTransferRegistry,
    @InjectRepository(PosSale) private readonly sales: Repository<PosSale>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async exportPage(organizationId: string, take: number, skip: number) {
    const [sales, total] = await this.sales.findAndCount({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take,
      skip,
    });
    const rows = sales.map((sale) => ({
      ...sale,
      itemCount: (sale.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
    }));
    return { rows: rows as unknown as Array<Record<string, unknown>>, total };
  }
}
