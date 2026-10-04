import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
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
export class PurchaseOrderReceipt extends BaseEntity {
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
  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'jsonb', default: [] })
  lines: PurchaseOrderReceiptLine[];

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_purchase_order_receipts_organization')
  organization?: TenantRef;
}
