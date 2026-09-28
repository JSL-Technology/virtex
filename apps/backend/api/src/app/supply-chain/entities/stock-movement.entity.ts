import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { Product } from '../../inventory/entities/product.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

export type StockMovementType =
  | 'PURCHASE_RECEIPT'
  | 'SALE_DISPATCH'
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
export class StockMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

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
}
