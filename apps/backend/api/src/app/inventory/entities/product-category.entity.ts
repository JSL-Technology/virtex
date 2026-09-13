import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

/**
 * The tenant's own product categories.
 *
 * ## Why this exists
 *
 * `products.category` was free text, and the only place that offered a value was a `<select>` with
 * three options written into the template — `Electrónica`, `Accesorios`, `Monitores`. Every tenant
 * of the product, in every market, was asked to file what they sell under a demo catalogue from a
 * computer shop; the register then showed whatever string had been stored, which is how the same
 * catalogue read `Electronics` in the form and `Electrónica` in the list.
 *
 * A category is master data: it belongs to the tenant, it is named in their language, it is
 * created and renamed by them, and renaming it must move every product with it. That is a table,
 * not a literal.
 *
 * ## Why a tree
 *
 * Because every ERP this competes with has one, and for the same reason: a business with two
 * hundred SKUs groups them more than one level deep (`Bebidas > Gaseosas > 2 L`), and a flat list
 * forces that structure into the name, where nothing can aggregate on it. `parentId` is nullable —
 * a flat catalogue is simply a tree one level deep, so nobody pays for the hierarchy until they
 * use it.
 */
@Entity('product_categories')
// Unique per tenant, not globally: two tenants may both have a "Servicios", and neither should
// learn of the other's existence by being refused the name.
@Index('IDX_product_categories_org_name', ['organizationId', 'name'], { unique: true })
@Index('IDX_product_categories_org_parent', ['organizationId', 'parentId'])
export class ProductCategory extends BaseEntity {
  @Column({ length: 100 })
  name: string;

  /**
   * A short code the tenant may use in their own reporting, and which an import can match on.
   *
   * Optional: a category is identified by its name to the people using it, and demanding a code
   * before the first product can be filed is friction with no payoff.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  code: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => ProductCategory, (category) => category.children, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'parent_id', foreignKeyConstraintName: 'FK_product_categories_parent' })
  parent: ProductCategory | null;

  @OneToMany(() => ProductCategory, (category) => category.parent)
  children: ProductCategory[];

  /**
   * Whether it may still be chosen.
   *
   * Deactivated rather than deleted, because a category that has been used is part of the history
   * of what was sold under it: deleting it would silently reclassify past products.
   */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
