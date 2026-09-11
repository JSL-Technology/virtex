
import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

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

  @Column({ name: 'total_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ name: 'required_date', type: 'date', nullable: true })
  requiredDate: string;
}
