import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import type { SalesOrder } from './sales-order.entity';

/** One line of a sales order. Its tenant is its order's. */
@Entity({ name: 'sales_order_lines' })
@Check(
  'CHK_sales_order_lines_quantities',
  `"delivered_quantity" >= 0 AND "invoiced_quantity" >= 0 AND "delivered_quantity" <= "quantity" AND "invoiced_quantity" <= "quantity"`,
)
export class SalesOrderLine {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_sales_order_lines' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne('SalesOrder', 'lines', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id', foreignKeyConstraintName: 'FK_sales_order_lines_order' })
  order?: SalesOrder;

  @Column({ name: 'line_order', type: 'integer', default: 0 })
  lineOrder: number;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  /** Goods leave with a conduce; services and non-stocked items are invoiced without one. */
  @Column({ name: 'is_stocked', type: 'boolean', default: false })
  isStocked: boolean;

  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numericTransformerNotNull })
  quantity: number;

  @Column({ name: 'delivered_quantity', type: 'numeric', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  deliveredQuantity: number;

  @Column({ name: 'invoiced_quantity', type: 'numeric', precision: 18, scale: 6, default: 0, transformer: numericTransformerNotNull })
  invoicedQuantity: number;

  @Column({ name: 'unit_price', type: 'numeric', precision: 18, scale: 6, transformer: numericTransformerNotNull })
  unitPrice: number;

  @Column({ name: 'discount_rate', type: 'numeric', precision: 7, scale: 6, default: 0, transformer: numericTransformerNotNull })
  discountRate: number;

  @Column({ name: 'tax_rate', type: 'numeric', precision: 7, scale: 6, default: 0, transformer: numericTransformerNotNull })
  taxRate: number;

  @Column({ name: 'line_total', type: 'numeric', precision: 18, scale: 2, default: 0, transformer: numericTransformerNotNull })
  lineTotal: number;
}
