import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { Product } from '../../inventory/entities/product.entity';
import { Warehouse } from './warehouse.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

export type StockMovementType =
  /** What the company held when its books were opened, or when a product was created holding it. */
  | 'OPENING'
  | 'PURCHASE_RECEIPT'
  /** Goods back to the supplier, or a purchase undone (a voided vendor bill). */
  | 'PURCHASE_RETURN'
  | 'SALE_DISPATCH'
  /** Goods back from a customer: a credit note that restocks. */
  | 'SALE_RETURN'
  | 'ADJUSTMENT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN';

/**
 * Audit trail of every quantity change for a product — the stock ledger (kardex).
 *
 * Moved from inventory/entities/warehouse.entity.ts — stock movements are warehouse history and
 * belong to supply-chain, not the product catalogue.
 *
 * It existed and nothing wrote it: `productId` was mapped to a stray varchar column beside the real
 * `product_id` foreign key, so the entity could not have been saved even if something had tried. A
 * goods receipt now records one row per line (QA C-07), with the document it came from, so "why
 * did the stock of this item change?" has an answer.
 */
@Entity({ name: 'stock_movements' })
@Index('IDX_stock_movements_product_date', ['productId', 'date'])
@Index('IDX_stock_movements_org_warehouse_date', ['organizationId', 'warehouseId', 'date'])
export class StockMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // A product with a stock history is deactivated, not deleted (QA C-03); checked at commit so the
  // tenant's own delete, which removes both, still goes through.
  @ManyToOne(() => Product, { onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /**
   * Where the goods moved. Every movement has one: the kardex is read per warehouse, and a
   * company-wide line could not be placed on any shelf. Rows from before warehouses were tracked
   * were assigned to the company's default warehouse when this column was added.
   */
  @ManyToOne(() => Warehouse, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'warehouse_id', foreignKeyConstraintName: 'FK_stock_movements_warehouse' })
  warehouse?: Warehouse;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId: string;

  /** The tenant, recorded directly so the ledger can be read without joining the catalogue. */
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  /** Signed: positive in, negative out. */
  @Column({ type: 'decimal', precision: 18, scale: 6, transformer: numericTransformerNotNull })
  quantity: number;

  /** Unit cost of the movement, in the books' currency. */
  @Column({ type: 'decimal', precision: 18, scale: 6, transformer: numericTransformerNotNull })
  cost: number;

  @Column()
  type: StockMovementType;

  /** The human reference: the order number, the invoice number. */
  @Column()
  reference: string;

  /** What produced it — `purchase_order_receipt`, `vendor_bill`… — and its id. */
  @Column({ name: 'source_type', type: 'varchar', length: 40, nullable: true })
  sourceType: string | null;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId: string | null;

  @CreateDateColumn()
  date: Date;

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_stock_movements_organization')
  organization?: TenantRef;
}
