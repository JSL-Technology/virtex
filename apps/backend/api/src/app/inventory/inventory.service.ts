import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { CostingMethod, Product, ProductKind } from './entities/product.entity';
import { StockMovement, StockMovementType } from '../supply-chain/entities/stock-movement.entity';
import { standardSalesTaxRate } from './contracts/sellable-product.contract';
import { GoodsReceiptPort, GoodsReceiptRequest, GoodsReceiptResult } from './contracts/goods-receipt.contract';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { InventoryPostingService } from './inventory-posting.service';
import { ProductCategoriesService } from './product-categories.service';
import { likeTerm } from '../common/database/search-term';

import { assertNoDependents, DependentReference } from '../common/database/dependents';

/** Documents that name a product by id. A product on any of them is deactivated, not deleted. */
const PRODUCT_DEPENDENTS: readonly DependentReference[] = [
  { table: 'invoice_line_item', column: 'productId', label: 'common.dependents.invoice_lines' },
  { table: 'purchase_order_lines', column: 'product_id', label: 'common.dependents.purchase_order_lines' },
  { table: 'purchase_requisition_lines', column: 'product_id', label: 'common.dependents.requisition_lines' },
  { table: 'quote_lines', column: 'product_id', label: 'common.dependents.quote_lines' },
  { table: 'vendor_bill_line', column: 'product_id', label: 'common.dependents.vendor_bill_lines' },
  { table: 'stock_movements', column: 'product_id', label: 'common.dependents.stock_movements' },
  { table: 'bill_of_materials', column: 'product_id', label: 'common.dependents.boms' },
  { table: 'production_orders', column: 'product_id', label: 'common.dependents.production_orders' },
];

@Injectable()
export class InventoryService implements GoodsReceiptPort {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
    /**
     * Stock is an asset. Creating or changing it from this catalogue used to move that asset with
     * no entry in the books at all — see `InventoryPostingService`.
     */
    private readonly posting: InventoryPostingService,
    /** The category on a product must be one of this tenant's, and one still being offered. */
    private readonly categories: ProductCategoriesService,
  ) {}

  /**
   * Create a product, and recognise the stock it is created holding.
   *
   * One transaction: a product saved without its opening entry is exactly the state that put the
   * inventory account below zero on the first sale, so the two either both happen or neither does.
   */
  async create(
    createProductDto: CreateProductDto,
    organizationId: string,
    actorUserId: string | null = null,
  ): Promise<Product> {
    await this.categories.assertUsable(createProductDto.categoryId, organizationId);
    return this.dataSource.transaction(async (manager) => {
      // A taxed item states its rate. When the form leaves it out, the tenant's standard rate is
      // written — not 0, which the till and the invoice would otherwise read as "taxed at zero".
      const treatment = createProductDto.taxTreatment ?? 'TAXED';
      const taxRate =
        treatment === 'TAXED'
          ? createProductDto.taxRate && createProductDto.taxRate > 0
            ? createProductDto.taxRate
            : await standardSalesTaxRate(manager, organizationId)
          : 0;
      const product = await manager.save(
        manager.create(Product, { ...createProductDto, taxTreatment: treatment, taxRate, organizationId }),
      );
      await this.posting.postOpeningStock(manager, product, actorUserId);
      return product;
    });
  }

  /**
   * El catálogo del inquilino, opcionalmente acotado a lo que se busca.
   *
   * Los dos parámetros son opcionales y OMITIRLOS ES EL COMPORTAMIENTO DE SIEMPRE —la lista
   * entera, en el mismo orden—, así que nada de lo que llama hoy cambia. Existen para los
   * selectores de producto, que en la factura nueva, el pedido de compra, la solicitud y la lista
   * de precios se traían el catálogo completo para enseñar diez filas.
   *
   * Se busca por lo que el operador tiene delante: el nombre y el código del artículo.
   */
  findAll(
    organizationId: string,
    options: { search?: string; limit?: number } = {},
  ): Promise<Product[]> {
    const query = this.productRepository
      .createQueryBuilder('product')
      // The category travels with the product: the register shows its name, and looking each one
      // up separately would be one query per row.
      .leftJoinAndSelect('product.category', 'category')
      .where('product.organizationId = :organizationId', { organizationId })
      .orderBy('product.name', 'ASC');

    const term = likeTerm(options.search);
    if (term) {
      query.andWhere('(product.name ILIKE :term OR product.sku ILIKE :term)', { term });
    }

    if (options.limit !== undefined && options.limit > 0) {
      query.take(options.limit);
    }

    return query.getMany();
  }

  async findOne(id: string, organizationId: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id, organizationId },
      relations: ['category'],
    });
    if (!product) {
      throw new NotFoundError('inventory.product_id_not_found', { id });
    }
    return product;
  }

  /**
   * Edit a product, and recognise any change in what its stock is worth.
   *
   * Both a new quantity and a new unit cost move the value on the balance sheet, and both arrive
   * through this one form, so the difference in value is what gets posted — one figure that covers
   * a stock count, a breakage and a revaluation alike.
   */
  async update(
    id: string,
    updateProductDto: UpdateProductDto,
    organizationId: string,
    actorUserId: string | null = null,
  ): Promise<Product> {
    await this.categories.assertUsable(updateProductDto.categoryId, organizationId);
    return this.dataSource.transaction(async (manager) => {
      const product = await manager.findOne(Product, { where: { id, organizationId } });
      if (!product) {
        throw new NotFoundError('inventory.product_id_not_found', { id });
      }
      const before = { quantity: product.stock, unitCost: product.cost };
      const { adjustmentReason, ...changes } = updateProductDto;

      // Changing what is on hand, or what it is worth, posts an adjustment. It needs a reason
      // (QA M-08): the product form used to change stock 46 → 999 and post 571,800 to the books
      // with nobody asked why.
      const stockChanges =
        changes.stock !== undefined && Number(changes.stock) !== Number(product.stock);
      const costChanges =
        changes.cost !== undefined && Number(changes.cost) !== Number(product.cost) && Number(product.stock) !== 0;
      if ((stockChanges || costChanges) && product.kind !== ProductKind.SERVICE && !adjustmentReason?.trim()) {
        throw new BadRequestError('inventory.adjustment_reason_required');
      }
      if (changes.taxTreatment && changes.taxTreatment !== 'TAXED') changes.taxRate = 0;

      const updated = await manager.save(manager.merge(Product, product, changes));
      await this.posting.postValuationChange(manager, updated, before, actorUserId, adjustmentReason?.trim());
      if (stockChanges) {
        await this.recordMovement(manager, organizationId, {
          productId: updated.id,
          quantity: Number(updated.stock) - Number(before.quantity),
          unitCost: Number(updated.cost),
          type: 'ADJUSTMENT',
          reference: (adjustmentReason ?? '').trim().slice(0, 255),
          sourceType: 'product_adjustment',
          sourceId: updated.id,
        });
      }
      return updated;
    });
  }

  /**
   * Delete a product, writing off anything it was still holding.
   *
   * Removing the row on its own left the value of that stock sitting in the inventory account with
   * nothing in the catalogue to account for it — an asset no one could ever explain or count.
   */
  async remove(
    id: string,
    organizationId: string,
    actorUserId: string | null = null,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const product = await manager.findOne(Product, { where: { id, organizationId } });
      if (!product) {
        throw new NotFoundError('inventory.product_id_not_found', { id });
      }
      // QA C-03: a product that appears on invoices or orders was deleted (and its invoice lines
      // silently lost their product). It is deactivated instead; only an unused product goes.
      await assertNoDependents(manager, product.id, PRODUCT_DEPENDENTS, 'inventory.product_delete_blocked');
      const before = { quantity: product.stock, unitCost: product.cost };
      product.stock = 0;
      await this.posting.postValuationChange(manager, product, before, actorUserId);
      await manager.remove(product);
    });
  }

  /**
   * Move stock out, under a row lock and scoped to the tenant.
   *
   * Two defects fixed together. It read the product with `findOneBy`, checked the balance and saved
   * — a read-modify-write with no lock, so two concurrent sales of the last unit both saw stock and
   * both succeeded, overselling it. And it did not filter by organization, so the caller's tenant
   * scoping was the only thing standing between a product id and another tenant's inventory.
   *
   * `SELECT … FOR UPDATE` serialises the two transactions; the second waits and then sees the
   * decremented balance.
   */
  async decreaseStock(
    productId: string,
    quantity: number,
    manager: EntityManager,
    organizationId: string,
  ): Promise<void> {
    const product = await this.lockProduct(productId, organizationId, manager);

    const available = Number(product.stock);
    if (available < quantity) {
      throw new BadRequestError('inventory.not_enough_stock_name_available_available', { name: product.name, available, quantity });
    }

    product.stock = available - quantity;
    await manager.save(Product, product);
  }

  /** Move stock back in — a return, a credit note that restocks — under the same lock. */
  async increaseStock(
    productId: string,
    quantity: number,
    manager: EntityManager,
    organizationId: string,
  ): Promise<void> {
    const product = await this.lockProduct(productId, organizationId, manager);
    product.stock = Number(product.stock) + quantity;
    await manager.save(Product, product);
  }

  /**
   * Goods arriving from a supplier: stock in, unit cost re-averaged, a line in the stock ledger per
   * item, and the entry Dr Inventory / Cr Goods received not invoiced — all in the caller's
   * transaction, so a receipt either happens entirely or not at all (QA C-07).
   *
   * Lines for services, or with no catalogue product, are returned as not stocked: they arrive, but
   * there is nothing to count.
   *
   * The unit cost is re-averaged for weighted-average items — the default and the only method the
   * product values stock with today. Negative stock (oversold before the goods arrived) is treated
   * as zero on the old side of the average, so an oversell cannot drag the new cost through zero.
   */
  async receiveGoods(
    manager: EntityManager,
    organizationId: string,
    receipt: GoodsReceiptRequest,
    actorUserId: string | null,
  ): Promise<GoodsReceiptResult> {
    const stocked: boolean[] = [];
    const posted: Array<{ description: string; amount: number }> = [];

    for (const line of receipt.lines) {
      if (!line.productId || line.quantity <= 0) {
        stocked.push(false);
        continue;
      }
      const product = await this.lockProduct(line.productId, organizationId, manager);
      if (product.kind === ProductKind.SERVICE) {
        stocked.push(false);
        continue;
      }

      const onHand = Number(product.stock);
      const previousCost = Number(product.cost);
      const averagingBase = Math.max(onHand, 0);
      if (product.costingMethod === CostingMethod.WEIGHTED_AVERAGE || !product.costingMethod) {
        const denominator = averagingBase + line.quantity;
        product.cost =
          denominator > 0
            ? Math.round(((averagingBase * previousCost + line.quantity * line.unitCost) / denominator) * 1e6) / 1e6
            : line.unitCost;
      }
      product.stock = onHand + line.quantity;
      await manager.save(Product, product);

      await manager.save(
        manager.create(StockMovement, {
          productId: product.id,
          organizationId,
          quantity: line.quantity,
          cost: line.unitCost,
          type: 'PURCHASE_RECEIPT',
          reference: receipt.reference,
          sourceType: receipt.sourceType,
          sourceId: receipt.sourceId,
        }),
      );

      stocked.push(true);
      posted.push({
        description: product.name,
        amount: Math.round(line.quantity * line.unitCost * 100) / 100,
      });
    }

    const journalEntryId = posted.length && receipt.post !== false
      ? await this.posting.postGoodsReceipt(manager, organizationId, {
          reference: receipt.reference,
          sourceId: receipt.sourceId,
          date: receipt.date,
          lines: posted,
        }, actorUserId)
      : null;

    return { journalEntryId, stocked };
  }

  /**
   * Record a movement in the stock ledger without touching the balance — for callers that already
   * moved the balance themselves (a vendor bill receiving goods, a sale dispatching them).
   */
  async recordMovement(
    manager: EntityManager,
    organizationId: string,
    movement: {
      productId: string;
      quantity: number;
      unitCost: number;
      type: StockMovementType;
      reference: string;
      sourceType: string;
      sourceId: string;
    },
  ): Promise<void> {
    await manager.save(
      manager.create(StockMovement, {
        productId: movement.productId,
        organizationId,
        quantity: movement.quantity,
        cost: movement.unitCost,
        type: movement.type,
        reference: movement.reference,
        sourceType: movement.sourceType,
        sourceId: movement.sourceId,
      }),
    );
  }

  private async lockProduct(
    productId: string,
    organizationId: string,
    manager: EntityManager,
  ): Promise<Product> {
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
}
