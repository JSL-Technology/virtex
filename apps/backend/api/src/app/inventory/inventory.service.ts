import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { CostingMethod, Product, ProductKind } from './entities/product.entity';
import { StockMovementType } from '../supply-chain/entities/stock-movement.entity';
import { standardSalesTaxRate } from './contracts/sellable-product.contract';
import { GoodsReceiptPort, GoodsReceiptRequest, GoodsReceiptResult, GoodsReturnRequest } from './contracts/goods-receipt.contract';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { InventoryPostingService } from './inventory-posting.service';
import { StockLedgerService, StockPlace } from './stock-ledger.service';
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
  { table: 'inventory_adjustment_lines', column: 'product_id', label: 'common.dependents.stock_movements' },
  { table: 'stock_transfer_lines', column: 'product_id', label: 'common.dependents.stock_movements' },
  { table: 'bill_of_materials', column: 'product_id', label: 'common.dependents.boms' },
  { table: 'production_orders', column: 'product_id', label: 'common.dependents.production_orders' },
];

/** Where and why stock moves, from the document that moves it. */
export interface StockMovementContext {
  /** The document's branch or named warehouse; see `StockLedgerService.resolveWarehouse`. */
  place?: StockPlace;
  /** Defaults: a sale for stock out, a sale return for stock in. */
  type?: StockMovementType;
  reference: string;
  sourceType: string;
  sourceId: string | null;
}

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
    /** The only writer of what is held, per warehouse. */
    private readonly ledger: StockLedgerService,
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
      const { stock: openingStock = 0, warehouseId, ...fields } = createProductDto;
      let product = await manager.save(
        manager.create(Product, { ...fields, stock: 0, taxTreatment: treatment, taxRate, organizationId }),
      );
      // The opening stock is a movement like any other: it lands in a warehouse and on the kardex.
      if (openingStock > 0 && product.kind !== ProductKind.SERVICE) {
        ({ product } = await this.ledger.move(manager, organizationId, {
          productId: product.id,
          warehouseId: await this.ledger.resolveWarehouse(manager, organizationId, { warehouseId }),
          quantity: openingStock,
          unitCost: Number(product.cost),
          type: 'OPENING',
          reference: product.sku || product.name,
          sourceType: 'product_opening',
          sourceId: product.id,
        }));
      }
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
      const changes = { ...updateProductDto };
      // What is held changes through documents, not through the catalogue: an adjustment has a
      // warehouse, a reason, a number and its own entry, and the kardex shows it.
      if (changes.stock !== undefined && Number(changes.stock) !== Number(product.stock)) {
        throw new BadRequestError('inventory.stock_changes_through_adjustments');
      }
      delete changes.stock;
      // Revaluing stock that exists is an adjustment too. A cost on a product holding nothing
      // moves no value, so it is just the catalogue's figure.
      if (
        changes.cost !== undefined &&
        Number(changes.cost) !== Number(product.cost) &&
        Number(product.stock) !== 0 &&
        product.kind !== ProductKind.SERVICE
      ) {
        throw new BadRequestError('inventory.cost_changes_through_adjustments');
      }
      if (changes.kind === ProductKind.SERVICE && product.kind !== ProductKind.SERVICE && Number(product.stock) !== 0) {
        throw new BadRequestError('inventory.service_holds_no_stock', { name: product.name });
      }
      if (changes.taxTreatment && changes.taxTreatment !== 'TAXED') changes.taxRate = 0;

      return manager.save(manager.merge(Product, product, changes));
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
   * Goods leaving for a customer, or going back to a supplier: out of the document's warehouse,
   * under the ledger's locks, and onto the kardex.
   *
   * The lock and the tenant filter that made this safe against two sales of the last unit live in
   * `StockLedgerService.move` now, which is also where the quantity is checked — per warehouse.
   */
  async decreaseStock(
    productId: string,
    quantity: number,
    manager: EntityManager,
    organizationId: string,
    movement: StockMovementContext,
  ): Promise<void> {
    await this.ledger.move(manager, organizationId, {
      productId,
      warehouseId: await this.ledger.resolveWarehouse(manager, organizationId, movement.place),
      quantity: -Math.abs(quantity),
      type: movement.type ?? 'SALE_DISPATCH',
      reference: movement.reference,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
    });
  }

  /** Goods coming back — a credit note that restocks — into the document's warehouse. */
  async increaseStock(
    productId: string,
    quantity: number,
    manager: EntityManager,
    organizationId: string,
    movement: StockMovementContext,
  ): Promise<void> {
    await this.ledger.move(manager, organizationId, {
      productId,
      warehouseId: await this.ledger.resolveWarehouse(manager, organizationId, movement.place),
      quantity: Math.abs(quantity),
      type: movement.type ?? 'SALE_RETURN',
      reference: movement.reference,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
    });
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
   * product values stock with today — over the company's whole stock, because the cost is one per
   * product. Negative stock (oversold before the goods arrived) is treated as zero on the old side
   * of the average, so an oversell cannot drag the new cost through zero.
   */
  async receiveGoods(
    manager: EntityManager,
    organizationId: string,
    receipt: GoodsReceiptRequest,
    actorUserId: string | null,
  ): Promise<GoodsReceiptResult> {
    const stocked: boolean[] = [];
    const posted: Array<{ description: string; amount: number }> = [];
    let warehouseId: string | null = null;

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
        await manager.save(Product, product);
      }

      warehouseId ??= await this.ledger.resolveWarehouse(manager, organizationId, receipt.place);
      await this.ledger.move(manager, organizationId, {
        productId: product.id,
        warehouseId,
        quantity: line.quantity,
        unitCost: line.unitCost,
        type: 'PURCHASE_RECEIPT',
        reference: receipt.reference,
        sourceType: receipt.sourceType,
        sourceId: receipt.sourceId,
      });

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

    return { journalEntryId, stocked, warehouseId };
  }

  /**
   * Undo a receipt (see `GoodsReceiptPort.returnGoods`).
   *
   * For a weighted-average item the receipt's value comes back out of the average exactly as it
   * went in: what remains is valued at (stock × cost − returned × receipt cost) / remaining stock.
   * That keeps the inventory account and the stock it describes equal once the return entry
   * (Dr GRNI / Cr Inventory, at the same values) is posted. If nothing remains, the cost is left as it was — there is nothing left to value.
   */
  async returnGoods(
    manager: EntityManager,
    organizationId: string,
    request: GoodsReturnRequest,
    actorUserId: string | null,
  ): Promise<string | null> {
    const returned: Array<{ description: string; amount: number }> = [];
    for (const line of request.lines) {
      if (line.quantity <= 0) continue;
      const product = await this.lockProduct(line.productId, organizationId, manager);
      if (product.kind === ProductKind.SERVICE) continue;
      returned.push({ description: product.name, amount: Math.round(line.quantity * line.unitCost * 100) / 100 });
      const warehouseId =
        request.warehouseId ?? (await this.ledger.resolveWarehouse(manager, organizationId, {}));

      const onHand = Number(product.stock);
      const remaining = onHand - line.quantity;
      if (
        (product.costingMethod === CostingMethod.WEIGHTED_AVERAGE || !product.costingMethod) &&
        remaining > 0
      ) {
        const value = onHand * Number(product.cost) - line.quantity * line.unitCost;
        product.cost = Math.max(0, Math.round((value / remaining) * 1e6) / 1e6);
        await manager.save(Product, product);
      }

      await this.ledger.move(manager, organizationId, {
        productId: product.id,
        warehouseId,
        quantity: -line.quantity,
        unitCost: line.unitCost,
        type: 'PURCHASE_RETURN',
        reference: request.reference,
        sourceType: request.sourceType,
        sourceId: request.sourceId,
      });
    }

    if (!request.posted) return null;
    return this.posting.postGoodsReturn(
      manager,
      organizationId,
      {
        reference: request.reference,
        sourceId: request.sourceId,
        date: request.date,
        reason: request.reason,
        lines: returned,
      },
      actorUserId,
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
