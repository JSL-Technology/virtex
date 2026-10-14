import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { numericTransformer } from '../../common/database/numeric.transformer';
import type { Product } from './product.entity';

/**
 * One change to a product's sale price or unit cost: what it was, what it became, who, when.
 *
 * Editing a product used to overwrite both figures and leave nothing behind, so neither a person
 * nor the anomaly engine could answer "when did this get 60 % cheaper, and who did it". Written by
 * `InventoryService.update` in the same transaction as the change; never edited afterwards.
 */
@Entity({ name: 'product_price_history' })
@Index('IDX_product_price_history_org_product_changed', ['organizationId', 'productId', 'changedAt'])
export class ProductPriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_product_price_history_organization')
  organization?: TenantRef;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne('Product', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_product_price_history_product' })
  product?: Product;

  @Column({ name: 'old_price', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  oldPrice: number | null;

  @Column({ name: 'new_price', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  newPrice: number | null;

  @Column({ name: 'old_cost', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  oldCost: number | null;

  @Column({ name: 'new_cost', type: 'decimal', precision: 18, scale: 6, nullable: true, transformer: numericTransformer })
  newCost: number | null;

  @Column({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
  changedByUserId: string | null;

  @CreateDateColumn({ name: 'changed_at', type: 'timestamptz' })
  changedAt: Date;
}
