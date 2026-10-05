import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { Product, ProductKind } from './entities/product.entity';
import { StockMovement, StockMovementType } from '../supply-chain/entities/stock-movement.entity';
import { StockLevel } from '../supply-chain/entities/stock-level.entity';
import { Warehouse } from '../supply-chain/entities/warehouse.entity';
import { branchDefaultWarehouseId } from '../organizations/contracts/branch.contract';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';

/** Quantities are stored to six decimals; anything smaller is rounding, not stock. */
const QUANTITY_EPSILON = 1e-9;

const roundQuantity = (value: number): number => Math.round(value * 1e6) / 1e6;

/** One movement of one product in one warehouse. */
export interface StockMove {
  productId: string;
  warehouseId: string;
  /** Signed: positive in, negative out. */
  quantity: number;
  /** What it is valued at. Omitted, the product's current average cost. */
  unitCost?: number;
  type: StockMovementType;
  /** The human reference: the invoice number, the adjustment number. */
  reference: string;
  /** What produced it — `invoice`, `inventory_adjustment`… — and its id. */
  sourceType: string;
  sourceId: string | null;
  /** When it happened. Omitted, now. */
  date?: Date;
}

/** Where a document's stock moves, as far as the document knows. */
export interface StockPlace {
  /** Named on the document: wins. */
  warehouseId?: string | null;
  /** The branch the document was issued at: its default warehouse, or its only one. */
  branchId?: string | null;
}

/**
 * The stock ledger: the only code that changes what a warehouse holds.
 *
 * ## One writer
 *
 * Sales, purchases, the till, credit notes, voided bills, adjustments and transfers each used to
 * move `products.stock` their own way, and only purchases wrote the stock ledger — so the kardex
 * could not explain the balance beside it and there was no balance per warehouse at all. Every one
 * of them now calls `move()`, which in one locked step:
 *
 *   1. locks the product, then the product's row for that warehouse (always in that order, so two
 *      movements of the same product cannot deadlock);
 *   2. refuses to take out more than the warehouse holds — per warehouse, not per company: twelve
 *      units in Santiago do not let Santo Domingo sell one;
 *   3. writes the warehouse balance, the company total on the product, and the ledger line.
 *
 * The three therefore agree by construction: the warehouse balances add up to `products.stock`,
 * and the ledger adds up to each warehouse balance.
 */
@Injectable()
export class StockLedgerService {
  private readonly logger = new Logger(StockLedgerService.name);

  async move(
    manager: EntityManager,
    organizationId: string,
    move: StockMove,
  ): Promise<{ product: Product; balanceAfter: number }> {
    const quantity = roundQuantity(move.quantity);
    const product = await this.lockProduct(manager, organizationId, move.productId);
    if (product.kind === ProductKind.SERVICE) {
      throw new BadRequestError('inventory.service_holds_no_stock', { name: product.name });
    }

    const level = await this.lockLevel(manager, organizationId, product.id, move.warehouseId);
    const before = Number(level.quantityOnHand);
    const after = roundQuantity(before + quantity);
    if (quantity < 0 && after < -QUANTITY_EPSILON) {
      const warehouse = await manager.findOne(Warehouse, { where: { id: move.warehouseId, organizationId } });
      throw new BadRequestError('inventory.not_enough_stock_in_warehouse', {
        name: product.name,
        warehouse: warehouse?.name ?? '',
        available: before,
        quantity: Math.abs(quantity),
      });
    }

    level.quantityOnHand = after;
    await manager.save(StockLevel, level);

    product.stock = roundQuantity(Number(product.stock) + quantity);
    await manager.save(Product, product);

    await manager.save(
      manager.create(StockMovement, {
        productId: product.id,
        organizationId,
        warehouseId: move.warehouseId,
        quantity,
        cost: move.unitCost ?? Number(product.cost),
        type: move.type,
        reference: move.reference.slice(0, 255),
        sourceType: move.sourceType,
        sourceId: move.sourceId,
        ...(move.date ? { date: move.date } : {}),
      }),
    );

    return { product, balanceAfter: after };
  }

  /**
   * What one warehouse holds of one product, read under the same locks a movement takes — for a
   * caller that computes a movement from the balance (a stock count) and must not have a sale slip
   * in between the reading and the moving.
   */
  async lockedBalance(
    manager: EntityManager,
    organizationId: string,
    productId: string,
    warehouseId: string,
  ): Promise<{ product: Product; balance: number }> {
    const product = await this.lockProduct(manager, organizationId, productId);
    const level = await this.lockLevel(manager, organizationId, productId, warehouseId);
    return { product, balance: Number(level.quantityOnHand) };
  }

  /** What one warehouse holds of one product, read without locking. */
  async balance(manager: EntityManager, productId: string, warehouseId: string, organizationId?: string): Promise<number> {
    const level = await manager.findOne(StockLevel, {
      where: organizationId ? { productId, warehouseId, organizationId } : { productId, warehouseId },
    });
    return Number(level?.quantityOnHand ?? 0);
  }

  /**
   * The warehouse a document's stock moves in.
   *
   * The one the document names, if it is this company's and open; otherwise its branch's default
   * warehouse, or the branch's only warehouse; otherwise the company's default — created as
   * «Almacén principal» the first time a company without warehouses moves stock, so a company that
   * never set warehouses up keeps working and every movement still has a place.
   */
  async resolveWarehouse(manager: EntityManager, organizationId: string, place: StockPlace = {}): Promise<string> {
    if (place.warehouseId) {
      const named = await manager.findOne(Warehouse, { where: { id: place.warehouseId, organizationId } });
      if (!named) throw new BadRequestError('inventory.warehouse_not_found');
      if (!named.isActive) throw new BadRequestError('inventory.warehouse_inactive', { name: named.name });
      return named.id;
    }

    if (place.branchId) {
      const branchDefault = await branchDefaultWarehouseId(manager, organizationId, place.branchId);
      if (branchDefault) {
        const warehouse = await manager.findOne(Warehouse, { where: { id: branchDefault, organizationId, isActive: true } });
        if (warehouse) return warehouse.id;
      }
      const ofBranch = await manager.find(Warehouse, {
        where: { organizationId, branchId: place.branchId, isActive: true },
        select: { id: true },
        take: 2,
      });
      if (ofBranch.length === 1) return ofBranch[0].id;
    }

    return (await this.defaultWarehouse(manager, organizationId)).id;
  }

  /** The company's default warehouse, designated or created on first need. */
  async defaultWarehouse(manager: EntityManager, organizationId: string): Promise<Warehouse> {
    const designated = await manager.findOne(Warehouse, { where: { organizationId, isDefault: true } });
    if (designated) return designated;

    const oldest = await manager.findOne(Warehouse, {
      where: { organizationId, isActive: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    // Two first movements of a new company can race to designate one; the unique index lets only
    // one win. Inside a transaction the loser's failure would abort everything after it, so the
    // attempt runs under a savepoint and the loser reads the winner's row instead.
    const inTransaction = manager.queryRunner?.isTransactionActive === true;
    if (inTransaction) await manager.query('SAVEPOINT designate_default_warehouse');
    try {
      let designated: Warehouse;
      if (oldest) {
        oldest.isDefault = true;
        designated = await manager.save(Warehouse, oldest);
      } else {
        designated = await manager.save(
          manager.create(Warehouse, {
            organizationId,
            name: 'Almacén principal',
            code: 'PRINCIPAL',
            isActive: true,
            isDefault: true,
          }),
        );
        this.logger.log(`Almacén principal creado para ${organizationId}.`);
      }
      if (inTransaction) await manager.query('RELEASE SAVEPOINT designate_default_warehouse');
      return designated;
    } catch (error) {
      if (!(error instanceof QueryFailedError)) throw error;
      if (inTransaction) await manager.query('ROLLBACK TO SAVEPOINT designate_default_warehouse');
      const winner = await manager.findOne(Warehouse, { where: { organizationId, isDefault: true } });
      if (winner) return winner;
      throw error;
    }
  }

  private async lockProduct(manager: EntityManager, organizationId: string, productId: string): Promise<Product> {
    const product = await manager
      .createQueryBuilder(Product, 'product')
      .where('product.id = :productId', { productId })
      .andWhere('product.organizationId = :organizationId', { organizationId })
      .setLock('pessimistic_write')
      .getOne();
    if (!product) {
      throw new NotFoundError('inventory.product_product_id_not_found_organization', { productId });
    }
    return product;
  }

  /** The product's row for the warehouse, created at zero the first time, then locked. */
  private async lockLevel(
    manager: EntityManager,
    organizationId: string,
    productId: string,
    warehouseId: string,
  ): Promise<StockLevel> {
    await manager.query(
      `INSERT INTO "stock_levels" ("organization_id", "product_id", "warehouse_id", "quantity_on_hand")
       VALUES ($1, $2, $3, 0)
       ON CONFLICT ("product_id", "warehouse_id") DO NOTHING`,
      [organizationId, productId, warehouseId],
    );
    const level = await manager
      .createQueryBuilder(StockLevel, 'level')
      .where('level.organizationId = :organizationId', { organizationId })
      .andWhere('level.productId = :productId', { productId })
      .andWhere('level.warehouseId = :warehouseId', { warehouseId })
      .setLock('pessimistic_write')
      .getOne();
    if (!level) throw new NotFoundError('inventory.warehouse_not_found');
    return level;
  }
}
