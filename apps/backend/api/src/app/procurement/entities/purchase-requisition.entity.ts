
import { Entity, Column, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import { PurchaseRequisitionLine } from './purchase-requisition-line.entity';

export enum PurchaseRequisitionStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CONVERTED_TO_PO = 'CONVERTED_TO_PO'
}

@Entity('purchase_requisitions')
// The requisition number is unique per tenant, not across the whole database.
@Index('IDX_purchase_requisitions_org_number', ['organizationId', 'number'], { unique: true })
export class PurchaseRequisition extends BaseEntity {
  @Column()
  number: string;

  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  requestedByUserId: string;

  @Column({
    type: 'enum',
    enum: PurchaseRequisitionStatus,
    default: PurchaseRequisitionStatus.DRAFT
  })
  status: PurchaseRequisitionStatus;

  /**
   * The sum of the lines, kept on the document.
   *
   * Derived from the lines on every write rather than accepted from the caller: a total a client
   * can set independently of what it is buying is a number an approver signs that means nothing.
   */
  @Column('decimal', {
    name: 'total_amount',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  totalAmount: number;

  @Column({ name: 'required_date', type: 'date', nullable: true })
  requiredDate: string;

  /** Free-text justification. What an approver reads before deciding. */
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Who approved or rejected it, and when — the trail the status alone cannot carry. */
  @Column({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  /** The order this requisition became, once it was approved and placed. */
  @Column({ name: 'purchase_order_id', type: 'uuid', nullable: true })
  purchaseOrderId: string | null;

  @OneToMany(() => PurchaseRequisitionLine, (line) => line.requisition, { cascade: true })
  lines: PurchaseRequisitionLine[];
}
