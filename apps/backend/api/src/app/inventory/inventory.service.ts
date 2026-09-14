import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { InventoryPostingService } from './inventory-posting.service';
import { ProductCategoriesService } from './product-categories.service';

@Injectable()
export class InventoryService {
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
      const product = await manager.save(
        manager.create(Product, { ...createProductDto, organizationId }),
      );
      await this.posting.postOpeningStock(manager, product, actorUserId);
      return product;
    });
  }

  findAll(organizationId: string): Promise<Product[]> {
    return this.productRepository.find({
      where: { organizationId },
      // The category travels with the product: the register shows its name, and looking each one
      // up separately would be one query per row.
      relations: ['category'],
      order: { name: 'ASC' },
    });
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
      const updated = await manager.save(manager.merge(Product, product, updateProductDto));
      await this.posting.postValuationChange(manager, updated, before, actorUserId);
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
