import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { Product } from '../../inventory/entities/product.entity';
import { PurchaseOrder } from './purchase-order.entity';

/**
 * One line of an order: what, how much, at what agreed price.
 *
 * `receivedQuantity` is what makes the order answerable later. Without it the only question a
 * purchase order can answer is "what did we ask for"; with it, it can answer "what is still
 * outstanding", which is the one a buyer asks every day.
 */
@Entity('purchase_order_lines')
@Index('IDX_purchase_order_lines_order', ['orderId'])
@Check(
  'CHK_purchase_order_lines_received_within_ordered',
  '"received_quantity" >= 0 AND "received_quantity" <= "quantity"',
)
export class PurchaseOrderLine extends BaseEntity {
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => PurchaseOrder, (order) => order.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id', foreignKeyConstraintName: 'FK_purchase_order_lines_order' })
  order: PurchaseOrder;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_purchase_order_lines_product',
  })
  product: Product | null;

  @Column({ type: 'text' })
  description: string;

  @Column('decimal', {
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  quantity: number;

  /** How much of it has actually arrived. Drives the order's own status. */
  @Column('decimal', {
    name: 'received_quantity',
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  receivedQuantity: number;

  /** The price agreed with the supplier — not the catalogue's, which is what we would sell it for. */
  @Column('decimal', {
    name: 'unit_price',
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  unitPrice: number;

  /** Consumption-tax rate as a fraction (0.18 = 18 %), as it will appear on the bill. */
  @Column('decimal', {
    name: 'tax_rate',
    precision: 9,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxRate: number;

  @Column({ name: 'unit_of_measure', type: 'varchar', length: 16, default: 'UND' })
  unitOfMeasure: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
