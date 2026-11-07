import { Check, Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PurchaseOrderLine } from '../../procurement/entities/purchase-order-line.entity';
import type { VendorBill } from './vendor-bill.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

/**
 * Whether a bill line buys goods or services. The 606 reports the two bases separately and every
 * withholding regime that tells them apart levies on services only, so the split is a fact about
 * each line, not a figure typed for the whole document (audit 2026-10-31, AP-02).
 */
export enum VendorBillLineNature {
  GOODS = 'GOODS',
  SERVICES = 'SERVICES',
}

@Entity()
@Check('CHK_vendor_bill_line_nature', `"nature" IS NULL OR "nature" IN ('GOODS', 'SERVICES')`)
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

  /**
   * Goods or services, as resolved when the bill was recorded: stated on the line, else the
   * catalogue product's kind, else services for a free expense line. NULL only on bills recorded
   * before the split was taken from the lines (migration VendorBillLineNature).
   */
  @Column({ name: 'nature', type: 'varchar', length: 8, nullable: true })
  nature?: VendorBillLineNature | null;

  /**
   * The part of the difference between this bill's price and the order's, on goods already
   * received, that went into the value of the stock still on hand (AP-05) — in the books'
   * currency. A void takes it back out of the average cost.
   */
  @Column('decimal', {
    name: 'received_cost_absorbed',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  receivedCostAbsorbed: number;

  /** How many units carried `receivedCostAbsorbed`: the ones a void must still find on hand. */
  @Column('decimal', {
    name: 'received_cost_units',
    precision: 18,
    scale: 6,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  receivedCostUnits: number;

  @ManyToOne(() => PurchaseOrderLine, { nullable: true, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
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