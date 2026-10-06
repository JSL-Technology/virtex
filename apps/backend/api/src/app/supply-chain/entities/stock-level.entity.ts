import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Product } from '../../inventory/entities/product.entity';
import { Warehouse } from './warehouse.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/**
 * How much of one product one warehouse holds — the balance the stock ledger adds up to.
 *
 * ## Why it exists beside `products.stock`
 *
 * `products.stock` is one number for the whole company. It cannot say that the twelve units are
 * in Santiago and the customer is in Santo Domingo, and every ERP's stock screen (MMBE, Inventory
 * Item Locations, Odoo's on-hand by location) starts from exactly that question. This is the
 * per-warehouse balance; `products.stock` stays as the company total because the catalogue, the
 * till and the dashboard read it, and both are written in the same locked step by
 * `StockLedgerService`, which is the only writer of either.
 *
 * It replaces `stock_items`, which nothing ever wrote: its columns were mapped twice (a varchar
 * `productId` beside the real `product_id` foreign key), so it could not have been saved anyway.
 * Lots and serials, which that table gestured at, belong to their own model when they are built.
 */
@Entity({ name: 'stock_levels' })
@Index('UQ_stock_levels_product_warehouse', ['productId', 'warehouseId'], { unique: true })
@Index('IDX_stock_levels_org_warehouse', ['organizationId', 'warehouseId'])
export class StockLevel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_stock_levels_organization')
  organization?: TenantRef;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_stock_levels_product' })
  product?: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  // A warehouse that holds stock cannot be deleted; it is deactivated once emptied.
  @ManyToOne(() => Warehouse, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'warehouse_id', foreignKeyConstraintName: 'FK_stock_levels_warehouse' })
  warehouse?: Warehouse;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  @Column({
    name: 'quantity_on_hand',
    type: 'decimal',
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  quantityOnHand: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
