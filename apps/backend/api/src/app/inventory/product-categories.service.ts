import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ProductCategory } from './entities/product-category.entity';
import { Product } from './entities/product.entity';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import {
  CreateProductCategoryDto,
  UpdateProductCategoryDto,
} from './dto/product-category.dto';

/** How deep the tree may go. Past this the name is doing the structuring, not the hierarchy. */
const MAX_DEPTH = 5;

/**
 * The tenant's product categories.
 *
 * Every rule here exists because the alternative silently corrupts the catalogue: a cycle makes
 * the tree unwalkable, a duplicate name makes two categories indistinguishable in every dropdown,
 * and deleting a category that products are filed under would reclassify them to nothing without
 * anybody asking.
 */
@Injectable()
export class ProductCategoriesService {
  constructor(
    @InjectRepository(ProductCategory)
    private readonly categories: Repository<ProductCategory>,
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  /**
   * The whole catalogue, ordered for a human: by explicit sort order, then by name.
   *
   * Not paginated: a category list is chosen from a dropdown, and a dropdown that pages is a
   * dropdown nobody can use. Tenants with thousands of categories do not exist; tenants with
   * thousands of products under fifty categories do.
   */
  findAll(organizationId: string, includeInactive = false): Promise<ProductCategory[]> {
    return this.categories.find({
      where: { organizationId, ...(includeInactive ? {} : { isActive: true }) },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<ProductCategory> {
    const category = await this.categories.findOne({ where: { id, organizationId } });
    if (!category) throw new NotFoundError('INVENTORY.CATEGORY_NOT_FOUND', { id });
    return category;
  }

  async create(
    dto: CreateProductCategoryDto,
    organizationId: string,
  ): Promise<ProductCategory> {
    const name = dto.name.trim();
    await this.assertNameFree(name, organizationId, null);
    const parentId = await this.resolveParent(dto.parentId ?? null, organizationId, null);

    const category = this.categories.create({
      organizationId,
      name,
      code: dto.code?.trim() || null,
      description: dto.description?.trim() || null,
      parentId,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });
    return this.categories.save(category);
  }

  async update(
    id: string,
    dto: UpdateProductCategoryDto,
    organizationId: string,
  ): Promise<ProductCategory> {
    const category = await this.findOne(id, organizationId);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      await this.assertNameFree(name, organizationId, id);
      category.name = name;
    }
    if (dto.code !== undefined) category.code = dto.code?.trim() || null;
    if (dto.description !== undefined) category.description = dto.description?.trim() || null;
    if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) category.isActive = dto.isActive;
    if (dto.parentId !== undefined) {
      category.parentId = await this.resolveParent(dto.parentId, organizationId, id);
    }

    return this.categories.save(category);
  }

  /**
   * Remove a category nothing depends on.
   *
   * A category with children or with products under it is refused rather than cascaded: both
   * cascades are silent reclassifications of data the tenant did not ask to change. Deactivating
   * is the operation for "stop offering this", and it is one field away.
   */
  async remove(id: string, organizationId: string): Promise<void> {
    await this.findOne(id, organizationId);

    const children = await this.categories.count({ where: { organizationId, parentId: id } });
    if (children > 0) {
      throw new BadRequestError('INVENTORY.CATEGORY_HAS_CHILDREN', { count: children });
    }

    const used = await this.products.count({ where: { organizationId, categoryId: id } });
    if (used > 0) {
      throw new BadRequestError('INVENTORY.CATEGORY_IN_USE', { count: used });
    }

    await this.categories.delete({ id, organizationId });
  }

  // ── Rules ──────────────────────────────────────────────────────────────────

  private async assertNameFree(
    name: string,
    organizationId: string,
    exceptId: string | null,
  ): Promise<void> {
    if (!name) throw new BadRequestError('INVENTORY.CATEGORY_NAME_REQUIRED');
    const clash = await this.categories.findOne({
      where: {
        organizationId,
        name,
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    if (clash) throw new BadRequestError('INVENTORY.CATEGORY_NAME_TAKEN', { name });
  }

  /**
   * Validate a proposed parent: it must exist, in this tenant, and not be the category itself or
   * any of its own descendants — a cycle makes every walk of the tree run forever.
   */
  private async resolveParent(
    parentId: string | null,
    organizationId: string,
    selfId: string | null,
  ): Promise<string | null> {
    if (!parentId) return null;
    if (selfId && parentId === selfId) {
      throw new BadRequestError('INVENTORY.CATEGORY_PARENT_IS_SELF');
    }

    const parent = await this.findOne(parentId, organizationId);

    let depth = 1;
    let cursor: ProductCategory | null = parent;
    const seen = new Set<string>([parent.id]);
    while (cursor?.parentId) {
      if (selfId && cursor.parentId === selfId) {
        throw new BadRequestError('INVENTORY.CATEGORY_PARENT_IS_DESCENDANT');
      }
      // Defensive: a cycle already in the data must not hang the request while we detect one.
      if (seen.has(cursor.parentId)) break;
      seen.add(cursor.parentId);
      depth += 1;
      if (depth > MAX_DEPTH) {
        throw new BadRequestError('INVENTORY.CATEGORY_TOO_DEEP', { max: MAX_DEPTH });
      }
      cursor = await this.categories.findOne({
        where: { id: cursor.parentId, organizationId },
      });
    }

    return parent.id;
  }

  /** Used by the product service: a category id must belong to this tenant and still be offered. */
  async assertUsable(categoryId: string | null | undefined, organizationId: string): Promise<void> {
    if (!categoryId) return;
    const category = await this.findOne(categoryId, organizationId);
    if (!category.isActive) {
      throw new BadRequestError('INVENTORY.CATEGORY_INACTIVE', { name: category.name });
    }
  }

  /** Categories with no parent, for a caller that only wants the top level. */
  roots(organizationId: string): Promise<ProductCategory[]> {
    return this.categories.find({
      where: { organizationId, parentId: IsNull(), isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }
}
