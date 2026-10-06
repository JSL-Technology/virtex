import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { PurchaseOrder } from './purchase-order.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';

/** One line of a delivery, as it was valued when it arrived. */
export interface PurchaseOrderReceiptLine {
  lineId: string;
  productId: string | null;
  description: string;
  quantity: number;
  /** Unit cost in the books' currency: the agreed price converted at the order's rate. */
  unitCost: number;
  /** Whether stock moved: false for a service line or a line with no catalogue product. */
  stocked: boolean;
}

export enum GoodsReceiptStatus {
  POSTED = 'POSTED',
  /** Undone: the stock went back out and the entry was reversed. The row and its number stay. */
  VOID = 'VOID',
}

/**
 * A delivery against a purchase order (QA C-07).
 *
 * One row per receipt, so a partial delivery has a history — what arrived, when, from whom and at
 * what value — and the journal entry it posted (Dr Inventory / Cr Goods received not invoiced)
 * points back at something a person can read. The lines are kept as they were valued at the time:
 * a later change of price on the order must not rewrite what was received.
 */
@Index('IDX_purchase_order_receipts_org_branch', ['organizationId', 'branchId'])
@Entity('purchase_order_receipts')
@Index('IDX_purchase_order_receipts_order', ['orderId'])
@Index('UQ_purchase_order_receipts_org_number', ['organizationId', 'number'], { unique: true })
@Index('IDX_purchase_order_receipts_org_date', ['organizationId', 'receivedAt'])
@Check('CHK_purchase_order_receipts_status', `"status" IN ('POSTED', 'VOID')`)
export class PurchaseOrderReceipt extends BaseEntity {
  /** `GR-2026-000042`: what the warehouse writes on the delivery note and the bill is matched to. */
  @Column({ type: 'varchar', length: 40 })
  number: string;

  @Column({ type: 'varchar', length: 16, default: GoodsReceiptStatus.POSTED })
  status: GoodsReceiptStatus;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  // Part of the order's own record, like its lines: it goes only when the order goes, and the
  // service never deletes an order that has been sent, let alone received against.
  @ManyToOne(() => PurchaseOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id', foreignKeyConstraintName: 'FK_purchase_order_receipts_order' })
  order?: PurchaseOrder;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;

  @Column({ name: 'received_by_user_id', type: 'uuid', nullable: true })
  receivedByUserId: string | null;

  /** The branch the goods arrived at. Null for a company without branches. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_purchase_order_receipts_branch')
  branch?: BranchRef | null;

  /**
   * The entry the receipt posted. An id, not a relation: the ledger belongs to Accounting, and a
   * purchasing row does not hold a foreign key into it (the same rule purchase orders follow).
   */
  /**
   * Where the goods arrived. Null on receipts from before stock was kept per warehouse, and on a
   * receipt of services only, which puts nothing on a shelf. Not a foreign key here: purchasing
   * does not import the warehouse entity; the stock ledger's own rows carry the constraint.
   */
  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId: string | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'void_reason', type: 'text', nullable: true })
  voidReason: string | null;

  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt: Date | null;

  @Column({ name: 'voided_by_user_id', type: 'uuid', nullable: true })
  voidedByUserId: string | null;

  /** The return entry (Dr GRNI / Cr Inventory) that undid the receipt when it was voided. */
  @Column({ name: 'reversal_journal_entry_id', type: 'uuid', nullable: true })
  reversalJournalEntryId: string | null;

  @Column({ type: 'jsonb', default: [] })
  lines: PurchaseOrderReceiptLine[];

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_purchase_order_receipts_organization')
  organization?: TenantRef;
}
