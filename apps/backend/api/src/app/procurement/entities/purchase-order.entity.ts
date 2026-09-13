import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { Supplier } from '../../suppliers/entities/supplier.entity';
import { PurchaseOrderLine } from './purchase-order-line.entity';

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  /** Sent to the supplier. From here on it is a commitment they have seen. */
  SENT = 'SENT',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

/**
 * An order placed with a supplier.
 *
 * ## Why it posts nothing
 *
 * A purchase order is a *commitment*, not a transaction. Nothing has been bought, nothing is owed
 * and nothing has moved until the goods or the invoice arrive, and the ledger is a record of what
 * happened rather than of what was agreed. So this document touches no account and moves no stock:
 * the vendor bill already debits inventory and credits payables when it is approved, and posting
 * here as well would count every purchase twice.
 *
 * What it does carry is the link both directions — which requisition it came from, and which bills
 * settled it — because that chain is what lets anybody answer "was this authorised, and did we get
 * what we ordered at the price we agreed?", which is the entire point of running purchasing
 * through a system rather than through email.
 *
 * ## What existed
 *
 * Nothing. The purchasing screen listed four orders — `PO-2025-001 OfiSuministros SRL $1,250.00
 * Sent` and three more — as literals in the browser bundle, identical for every tenant of the
 * product, with no table, no endpoint and no way to create a fifth.
 */
@Entity('purchase_orders')
@Index('IDX_purchase_orders_org_number', ['organizationId', 'number'], { unique: true })
@Index('IDX_purchase_orders_org_status', ['organizationId', 'status'])
export class PurchaseOrder extends BaseEntity {
  /** `PO-2026-000042`. Consecutive per tenant and year. */
  @Column()
  number: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplier_id', foreignKeyConstraintName: 'FK_purchase_orders_supplier' })
  supplier: Supplier;

  @Column({ name: 'order_date', type: 'date' })
  orderDate: string;

  /** When the supplier promised it. Null until they say.  */
  @Column({ name: 'expected_date', type: 'date', nullable: true })
  expectedDate: string | null;

  @Column({
    type: 'enum',
    enum: PurchaseOrderStatus,
    default: PurchaseOrderStatus.DRAFT,
  })
  status: PurchaseOrderStatus;

  @Column({ name: 'currency_code', type: 'varchar', length: 3, default: 'USD' })
  currencyCode: string;

  @Column('decimal', {
    name: 'exchange_rate',
    precision: 18,
    scale: 6,
    default: 1,
    transformer: numericTransformerNotNull,
  })
  exchangeRate: number;

  @Column('decimal', {
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  subtotal: number;

  @Column('decimal', {
    name: 'tax_total',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  taxTotal: number;

  @Column('decimal', {
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  total: number;

  /** The requisition this order fulfils, where it came from one. */
  @Column({ name: 'requisition_id', type: 'uuid', nullable: true })
  requisitionId: string | null;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @OneToMany(() => PurchaseOrderLine, (line) => line.order, { cascade: true })
  lines: PurchaseOrderLine[];
}
