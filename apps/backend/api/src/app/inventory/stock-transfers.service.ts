import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { StockTransfer, StockTransferLine, StockTransferStatus } from './entities/stock-transfer.entity';
import { Product, ProductKind } from './entities/product.entity';
import { Warehouse } from '../supply-chain/entities/warehouse.entity';
import { StockLedgerService } from './stock-ledger.service';
import { SaveStockTransferDto, StockTransferQueryDto } from './dto/stock-transfer.dto';
import { allocateDocumentNumber, DOCUMENT_SEQUENCE_SCOPE } from '../shared/numbering/document-numbers';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { toIsoDate } from '../common/dates';

export interface StockTransferView extends StockTransfer {
  fromWarehouseName: string | null;
  toWarehouseName: string | null;
  lines: Array<StockTransferLine & { productName: string; sku: string | null; available: number | null }>;
}

/**
 * Transfers between warehouses: drafted, then posted in one step.
 *
 * Posting moves each line out of the origin and into the destination at the product's average
 * cost, in one transaction: the company total never changes, nothing is booked (same company, same
 * inventory account), and the origin cannot send more than it holds — checked per line by the stock
 * ledger, under its locks, at the moment of posting.
 */
@Injectable()
export class StockTransfersService {
  private readonly logger = new Logger(StockTransfersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: StockLedgerService,
  ) {}

  async findAll(organizationId: string, query: StockTransferQueryDto = {}) {
    const qb = this.dataSource
      .getRepository(StockTransfer)
      .createQueryBuilder('transfer')
      .leftJoin('transfer.fromWarehouse', 'origin')
      .leftJoin('transfer.toWarehouse', 'destination')
      .addSelect(['origin.id', 'origin.name', 'destination.id', 'destination.name'])
      .loadRelationCountAndMap('transfer.lineCount', 'transfer.lines')
      .where('transfer.organizationId = :organizationId', { organizationId })
      .orderBy('transfer.date', 'DESC')
      .addOrderBy('transfer.number', 'DESC')
      .take(500);
    if (query.status) qb.andWhere('transfer.status = :status', { status: query.status });
    if (query.warehouseId) {
      qb.andWhere('(transfer.fromWarehouseId = :warehouseId OR transfer.toWarehouseId = :warehouseId)', {
        warehouseId: query.warehouseId,
      });
    }
    const rows = await qb.getMany();
    return rows.map(({ fromWarehouse, toWarehouse, ...row }) => ({
      ...row,
      fromWarehouseName: fromWarehouse?.name ?? null,
      toWarehouseName: toWarehouse?.name ?? null,
    }));
  }

  async findOne(id: string, organizationId: string, manager: EntityManager = this.dataSource.manager): Promise<StockTransferView> {
    const transfer = await manager.findOne(StockTransfer, {
      where: { id, organizationId },
      relations: { lines: { product: true }, fromWarehouse: true, toWarehouse: true },
      order: { lines: { id: 'ASC' } },
    });
    if (!transfer) throw new NotFoundError('inventory.transfer_not_found');
    const draft = transfer.status === StockTransferStatus.DRAFT;
    const lines = [];
    for (const line of transfer.lines) {
      const { product, ...rest } = line;
      lines.push({
        ...rest,
        productName: product?.name ?? '',
        sku: product?.sku ?? null,
        available: draft ? await this.ledger.balance(manager, line.productId, transfer.fromWarehouseId) : null,
      });
    }
    const { fromWarehouse, toWarehouse, ...rest } = transfer;
    return {
      ...rest,
      fromWarehouseName: fromWarehouse?.name ?? null,
      toWarehouseName: toWarehouse?.name ?? null,
      lines,
    } as StockTransferView;
  }

  async create(dto: SaveStockTransferDto, organizationId: string, actorUserId: string | null): Promise<StockTransferView> {
    const id = await this.dataSource.transaction(async (manager) => {
      await this.validate(manager, organizationId, dto);
      const date = toIsoDate(dto.date);
      const transfer = await manager.save(
        manager.create(StockTransfer, {
          organizationId,
          number: await allocateDocumentNumber(
            manager,
            organizationId,
            DOCUMENT_SEQUENCE_SCOPE.STOCK_TRANSFER,
            'TR',
            Number(date.slice(0, 4)),
          ),
          date,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          notes: dto.notes?.trim() || null,
          status: StockTransferStatus.DRAFT,
          createdByUserId: actorUserId,
          lines: dto.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        }),
      );
      return transfer.id;
    });
    return this.findOne(id, organizationId);
  }

  async update(id: string, dto: SaveStockTransferDto, organizationId: string): Promise<StockTransferView> {
    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lockDraft(manager, id, organizationId);
      await this.validate(manager, organizationId, dto);
      await manager.delete(StockTransferLine, { transferId: transfer.id });
      transfer.date = toIsoDate(dto.date);
      transfer.fromWarehouseId = dto.fromWarehouseId;
      transfer.toWarehouseId = dto.toWarehouseId;
      transfer.notes = dto.notes?.trim() || null;
      transfer.lines = dto.lines.map((line) =>
        manager.create(StockTransferLine, { productId: line.productId, quantity: line.quantity, transferId: transfer.id }),
      );
      await manager.save(transfer);
    });
    return this.findOne(id, organizationId);
  }

  async cancel(id: string, organizationId: string): Promise<StockTransferView> {
    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lockDraft(manager, id, organizationId);
      transfer.status = StockTransferStatus.CANCELLED;
      await manager.save(transfer);
    });
    return this.findOne(id, organizationId);
  }

  async post(id: string, organizationId: string, actorUserId: string | null): Promise<StockTransferView> {
    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lockDraft(manager, id, organizationId);
      // Both ends must still be open.
      await this.ledger.resolveWarehouse(manager, organizationId, { warehouseId: transfer.fromWarehouseId });
      await this.ledger.resolveWarehouse(manager, organizationId, { warehouseId: transfer.toWarehouseId });
      const lines = await manager.find(StockTransferLine, { where: { transferId: transfer.id }, order: { id: 'ASC' } });
      if (lines.length === 0) throw new BadRequestError('inventory.transfer_without_lines');

      for (const line of lines) {
        const leg = {
          productId: line.productId,
          reference: transfer.number,
          sourceType: 'stock_transfer',
          sourceId: transfer.id,
        };
        const { product } = await this.ledger.move(manager, organizationId, {
          ...leg,
          warehouseId: transfer.fromWarehouseId,
          quantity: -Number(line.quantity),
          type: 'TRANSFER_OUT',
        });
        await this.ledger.move(manager, organizationId, {
          ...leg,
          warehouseId: transfer.toWarehouseId,
          quantity: Number(line.quantity),
          unitCost: Number(product.cost),
          type: 'TRANSFER_IN',
        });
      }

      transfer.status = StockTransferStatus.POSTED;
      transfer.postedAt = new Date();
      transfer.postedByUserId = actorUserId;
      await manager.save(transfer);
      this.logger.log(`Transferencia ${transfer.number} contabilizada.`);
    });
    return this.findOne(id, organizationId);
  }

  private async lockDraft(manager: EntityManager, id: string, organizationId: string): Promise<StockTransfer> {
    const transfer = await manager
      .createQueryBuilder(StockTransfer, 'transfer')
      .where('transfer.id = :id', { id })
      .andWhere('transfer.organizationId = :organizationId', { organizationId })
      .setLock('pessimistic_write')
      .getOne();
    if (!transfer) throw new NotFoundError('inventory.transfer_not_found');
    if (transfer.status !== StockTransferStatus.DRAFT) {
      throw new ConflictError('inventory.transfer_not_draft', { number: transfer.number });
    }
    return transfer;
  }

  private async validate(manager: EntityManager, organizationId: string, dto: SaveStockTransferDto): Promise<void> {
    if (dto.fromWarehouseId === dto.toWarehouseId) throw new BadRequestError('inventory.transfer_same_warehouse');
    const warehouses = await manager.find(Warehouse, {
      where: { id: In([dto.fromWarehouseId, dto.toWarehouseId]), organizationId },
    });
    if (warehouses.length !== 2) throw new BadRequestError('inventory.warehouse_not_found');
    const closed = warehouses.find((warehouse) => !warehouse.isActive);
    if (closed) throw new BadRequestError('inventory.warehouse_inactive', { name: closed.name });

    const ids = dto.lines.map((line) => line.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestError('inventory.document_repeats_product');
    const products = await manager.find(Product, { where: { id: In(ids), organizationId }, select: { id: true, name: true, kind: true } });
    if (products.length !== ids.length) throw new BadRequestError('inventory.product_not_found_in_document');
    const service = products.find((product) => product.kind === ProductKind.SERVICE);
    if (service) throw new BadRequestError('inventory.service_holds_no_stock', { name: service.name });
  }
}
