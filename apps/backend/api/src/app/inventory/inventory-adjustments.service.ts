import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  InventoryAdjustment,
  InventoryAdjustmentLine,
  InventoryAdjustmentStatus,
} from './entities/inventory-adjustment.entity';
import { Product, ProductKind } from './entities/product.entity';
import { Warehouse } from '../supply-chain/entities/warehouse.entity';
import { StockLedgerService } from './stock-ledger.service';
import { InventoryPostingService } from './inventory-posting.service';
import { InventoryAdjustmentQueryDto, SaveInventoryAdjustmentDto } from './dto/inventory-adjustment.dto';
import { allocateDocumentNumber, DOCUMENT_SEQUENCE_SCOPE } from '../shared/numbering/document-numbers';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { roundAmount } from '../common/money';
import { toIsoDate } from '../common/dates';

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;
const EPSILON = 1e-9;

export interface InventoryAdjustmentView extends InventoryAdjustment {
  warehouseName: string | null;
  lines: Array<InventoryAdjustmentLine & { productName: string; sku: string | null; onHand: number | null }>;
}

/**
 * Inventory adjustments: drafted, reviewed, posted.
 *
 * Posting is where everything happens, in one transaction: each line's change is taken against the
 * warehouse balance read under the stock ledger's locks (so a count is right at the moment it is
 * booked, not at the moment it was typed), the stock moves, a surplus re-averages the unit cost, a
 * new unit cost revalues the product's whole stock, and one journal entry books the value moved
 * against the inventory adjustment account. A posted adjustment is final; it is corrected by
 * another adjustment, as its entry would be by another entry.
 */
@Injectable()
export class InventoryAdjustmentsService {
  private readonly logger = new Logger(InventoryAdjustmentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: StockLedgerService,
    private readonly posting: InventoryPostingService,
  ) {}

  async findAll(organizationId: string, query: InventoryAdjustmentQueryDto = {}) {
    const qb = this.dataSource
      .getRepository(InventoryAdjustment)
      .createQueryBuilder('adjustment')
      .leftJoin('adjustment.warehouse', 'warehouse')
      .addSelect(['warehouse.id', 'warehouse.name'])
      .loadRelationCountAndMap('adjustment.lineCount', 'adjustment.lines')
      .where('adjustment.organizationId = :organizationId', { organizationId })
      .orderBy('adjustment.date', 'DESC')
      .addOrderBy('adjustment.number', 'DESC')
      .take(500);
    if (query.status) qb.andWhere('adjustment.status = :status', { status: query.status });
    if (query.warehouseId) qb.andWhere('adjustment.warehouseId = :warehouseId', { warehouseId: query.warehouseId });
    const rows = await qb.getMany();
    return rows.map(({ warehouse, ...row }) => ({ ...row, warehouseName: warehouse?.name ?? null }));
  }

  async findOne(id: string, organizationId: string, manager: EntityManager = this.dataSource.manager): Promise<InventoryAdjustmentView> {
    const adjustment = await manager.findOne(InventoryAdjustment, {
      where: { id, organizationId },
      relations: { lines: { product: true }, warehouse: true },
      order: { lines: { id: 'ASC' } },
    });
    if (!adjustment) throw new NotFoundError('inventory.adjustment_not_found');
    const draft = adjustment.status === InventoryAdjustmentStatus.DRAFT;
    const lines = [];
    for (const line of adjustment.lines) {
      const { product, ...rest } = line;
      lines.push({
        ...rest,
        productName: product?.name ?? '',
        sku: product?.sku ?? null,
        // What the warehouse holds now — the figure a count is compared with on posting.
        onHand: draft ? await this.ledger.balance(manager, line.productId, adjustment.warehouseId) : null,
      });
    }
    const { warehouse, ...rest } = adjustment;
    return { ...rest, warehouseName: warehouse?.name ?? null, lines } as InventoryAdjustmentView;
  }

  async create(dto: SaveInventoryAdjustmentDto, organizationId: string, actorUserId: string | null): Promise<InventoryAdjustmentView> {
    const id = await this.dataSource.transaction(async (manager) => {
      await this.validate(manager, organizationId, dto);
      const date = toIsoDate(dto.date);
      const adjustment = await manager.save(
        manager.create(InventoryAdjustment, {
          organizationId,
          number: await allocateDocumentNumber(
            manager,
            organizationId,
            DOCUMENT_SEQUENCE_SCOPE.INVENTORY_ADJUSTMENT,
            'AJ',
            Number(date.slice(0, 4)),
          ),
          date,
          warehouseId: dto.warehouseId,
          reason: dto.reason.trim(),
          notes: dto.notes?.trim() || null,
          status: InventoryAdjustmentStatus.DRAFT,
          createdByUserId: actorUserId,
          lines: dto.lines.map((line) => this.lineFrom(line)),
        }),
      );
      return adjustment.id;
    });
    return this.findOne(id, organizationId);
  }

  async update(id: string, dto: SaveInventoryAdjustmentDto, organizationId: string): Promise<InventoryAdjustmentView> {
    await this.dataSource.transaction(async (manager) => {
      const adjustment = await this.lockDraft(manager, id, organizationId);
      await this.validate(manager, organizationId, dto);
      await manager.delete(InventoryAdjustmentLine, { adjustmentId: adjustment.id });
      adjustment.date = toIsoDate(dto.date);
      adjustment.warehouseId = dto.warehouseId;
      adjustment.reason = dto.reason.trim();
      adjustment.notes = dto.notes?.trim() || null;
      adjustment.lines = dto.lines.map((line) => manager.create(InventoryAdjustmentLine, { ...this.lineFrom(line), adjustmentId: adjustment.id }));
      await manager.save(adjustment);
    });
    return this.findOne(id, organizationId);
  }

  async cancel(id: string, organizationId: string): Promise<InventoryAdjustmentView> {
    await this.dataSource.transaction(async (manager) => {
      const adjustment = await this.lockDraft(manager, id, organizationId);
      adjustment.status = InventoryAdjustmentStatus.CANCELLED;
      await manager.save(adjustment);
    });
    return this.findOne(id, organizationId);
  }

  async post(id: string, organizationId: string, actorUserId: string | null): Promise<InventoryAdjustmentView> {
    await this.dataSource.transaction(async (manager) => {
      const adjustment = await this.lockDraft(manager, id, organizationId);
      const lines = await manager.find(InventoryAdjustmentLine, { where: { adjustmentId: adjustment.id }, order: { id: 'ASC' } });
      if (lines.length === 0) throw new BadRequestError('inventory.adjustment_without_lines');
      // The warehouse must still be open: a closed one takes no new stock and gives none.
      await this.ledger.resolveWarehouse(manager, organizationId, { warehouseId: adjustment.warehouseId });

      const valued: Array<{ description: string; amount: number }> = [];
      let total = 0;
      for (const line of lines) {
        const { product, balance } = await this.ledger.lockedBalance(manager, organizationId, line.productId, adjustment.warehouseId);
        if (product.kind === ProductKind.SERVICE) {
          throw new BadRequestError('inventory.service_holds_no_stock', { name: product.name });
        }
        const change = line.countedQuantity !== null && line.countedQuantity !== undefined
          ? round6(Number(line.countedQuantity) - balance)
          : round6(Number(line.quantityChange));
        let value = 0;
        let movedAt = Number(product.cost);

        if (change > EPSILON) {
          // A surplus enters at the cost stated, or at average; either way it is re-averaged in.
          movedAt = line.unitCost !== null && line.unitCost !== undefined ? Number(line.unitCost) : Number(product.cost);
          const base = Math.max(Number(product.stock), 0);
          const cost = base + change > 0 ? (base * Number(product.cost) + change * movedAt) / (base + change) : movedAt;
          product.cost = round6(cost);
          await manager.save(Product, product);
          value += change * movedAt;
        } else if (change < -EPSILON) {
          // A loss leaves at average cost: it is valued at what the books carry it at.
          value += change * Number(product.cost);
        }

        if (Math.abs(change) > EPSILON) {
          await this.ledger.move(manager, organizationId, {
            productId: product.id,
            warehouseId: adjustment.warehouseId,
            quantity: change,
            unitCost: movedAt,
            type: 'ADJUSTMENT',
            reference: `${adjustment.number} — ${adjustment.reason}`,
            sourceType: 'inventory_adjustment',
            sourceId: adjustment.id,
          });
        }

        // A new unit cost revalues everything held, in every warehouse — the cost is one per product.
        if (line.newUnitCost !== null && line.newUnitCost !== undefined) {
          const fresh = await manager.findOneOrFail(Product, { where: { id: product.id, organizationId } });
          const newCost = Number(line.newUnitCost);
          if (Math.abs(newCost - Number(fresh.cost)) > EPSILON) {
            value += Math.max(Number(fresh.stock), 0) * (newCost - Number(fresh.cost));
            fresh.cost = round6(newCost);
            await manager.save(Product, fresh);
          }
        }

        line.quantityBefore = balance;
        line.quantityChange = change;
        line.unitCost = movedAt;
        line.valueChange = roundAmount(value);
        await manager.save(InventoryAdjustmentLine, line);
        total += line.valueChange;
        valued.push({ description: product.name, amount: line.valueChange });
      }

      adjustment.valueChange = roundAmount(total);
      adjustment.journalEntryId = await this.posting.postAdjustment(
        manager,
        organizationId,
        { id: adjustment.id, number: adjustment.number, date: adjustment.date, reason: adjustment.reason, lines: valued },
        actorUserId,
      );
      adjustment.status = InventoryAdjustmentStatus.POSTED;
      adjustment.postedAt = new Date();
      adjustment.postedByUserId = actorUserId;
      await manager.save(adjustment);
      this.logger.log(`Ajuste ${adjustment.number} contabilizado (${adjustment.valueChange}).`);
    });
    return this.findOne(id, organizationId);
  }

  private lineFrom(line: SaveInventoryAdjustmentDto['lines'][number]): Partial<InventoryAdjustmentLine> {
    const counted = line.countedQuantity ?? null;
    return {
      productId: line.productId,
      countedQuantity: counted,
      quantityChange: counted === null ? Number(line.quantityChange ?? 0) : 0,
      unitCost: line.unitCost ?? null,
      newUnitCost: line.newUnitCost ?? null,
    };
  }

  private async lockDraft(manager: EntityManager, id: string, organizationId: string): Promise<InventoryAdjustment> {
    const adjustment = await manager
      .createQueryBuilder(InventoryAdjustment, 'adjustment')
      .where('adjustment.id = :id', { id })
      .andWhere('adjustment.organizationId = :organizationId', { organizationId })
      .setLock('pessimistic_write')
      .getOne();
    if (!adjustment) throw new NotFoundError('inventory.adjustment_not_found');
    if (adjustment.status !== InventoryAdjustmentStatus.DRAFT) {
      throw new ConflictError('inventory.adjustment_not_draft', { number: adjustment.number });
    }
    return adjustment;
  }

  /** The warehouse is this company's and open; every product is a good of this company, once. */
  private async validate(manager: EntityManager, organizationId: string, dto: SaveInventoryAdjustmentDto): Promise<void> {
    const warehouse = await manager.findOne(Warehouse, { where: { id: dto.warehouseId, organizationId } });
    if (!warehouse) throw new BadRequestError('inventory.warehouse_not_found');
    if (!warehouse.isActive) throw new BadRequestError('inventory.warehouse_inactive', { name: warehouse.name });

    const ids = dto.lines.map((line) => line.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestError('inventory.document_repeats_product');
    for (const line of dto.lines) {
      const hasCount = line.countedQuantity !== undefined && line.countedQuantity !== null;
      const hasChange = line.quantityChange !== undefined && line.quantityChange !== null && Number(line.quantityChange) !== 0;
      const hasCost = line.newUnitCost !== undefined && line.newUnitCost !== null;
      if (hasCount && hasChange) throw new BadRequestError('inventory.adjustment_line_count_or_change');
      if (!hasCount && !hasChange && !hasCost) throw new BadRequestError('inventory.adjustment_line_empty');
    }
    const products = await manager.find(Product, { where: { id: In(ids), organizationId }, select: { id: true, name: true, kind: true } });
    if (products.length !== ids.length) throw new BadRequestError('inventory.product_not_found_in_document');
    const service = products.find((product) => product.kind === ProductKind.SERVICE);
    if (service) throw new BadRequestError('inventory.service_holds_no_stock', { name: service.name });
  }
}
