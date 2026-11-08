import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PurchaseOrderReceipt } from './purchase-order-receipt.entity';

export interface PurchaseReturnLine {
  lineId: string;
  productId: string | null;
  description: string;
  quantity: number;
  /** At the cost the goods came in at, in the books' currency. */
  unitCost: number;
}

/**
 * Goods sent back to the supplier from a receipt (audit 2026-11-07, CMP-15): part of a delivery,
 * not the whole of it — voiding the receipt was the only way back. Stock leaves at the cost it
 * entered at, the order is owed those goods again, and Dr GRNI / Cr Inventory is posted.
 */
@Entity({ name: 'purchase_returns' })
@Index('IDX_purchase_returns_receipt', ['organizationId', 'receiptId'])
export class PurchaseReturn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  // By name: the entity is the organizations module's (verify:boundaries).
  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_purchase_returns_organization' })
  organization?: unknown;

  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ name: 'receipt_id', type: 'uuid' })
  receiptId: string;

  @ManyToOne(() => PurchaseOrderReceipt, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'receipt_id', foreignKeyConstraintName: 'FK_purchase_returns_receipt' })
  receipt?: PurchaseOrderReceipt;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'jsonb' })
  lines: PurchaseReturnLine[];

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
