import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PurchaseOrderLine } from '../../procurement/entities/purchase-order-line.entity';
import type { VendorBill } from './vendor-bill.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

@Entity()
export class VendorBillLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('VendorBill', 'lines', { onDelete: 'CASCADE' })
  vendorBill: VendorBill;

  @Column()
  product: string;


  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string;

  @Column({ name: 'expense_account_id', type: 'uuid', nullable: true })
  expenseAccountId?: string;


  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformerNotNull })
  quantity: number;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformerNotNull })
  unitPrice: number;

  @Column('decimal', { precision: 10, scale: 2, transformer: numericTransformerNotNull })
  total: number;

  /**
   * The purchase-order line this bills, when the bill was raised against an order.
   *
   * It is what lets posting tell goods that already arrived through a receipt (clear the
   * goods-received-not-invoiced balance, move no stock) from goods the bill itself brings in
   * (debit inventory, receive the stock). See migration GoodsReceipts.
   */
  @Column({ name: 'purchase_order_line_id', type: 'uuid', nullable: true })
  purchaseOrderLineId?: string | null;

  @ManyToOne(() => PurchaseOrderLine, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'purchase_order_line_id',
    foreignKeyConstraintName: 'FK_vendor_bill_line_purchase_order_line',
  })
  purchaseOrderLine?: PurchaseOrderLine | null;

  /**
   * How much of `quantity` was matched against goods already received, decided when the bill is
   * approved. That part cleared GRNI and moved no stock; the rest was received by the bill.
   * Voiding reads it back so it returns exactly what the bill itself brought in.
   */
  @Column('decimal', {
    name: 'grni_quantity',
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  grniQuantity: number;
}