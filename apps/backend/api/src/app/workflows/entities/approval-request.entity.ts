import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DocumentTypeForApproval } from './approval-policy.entity';

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'approval_requests' })
// Every read of this table is "the requests of this tenant", and there was no index at all.
@Index('IDX_approval_requests_org_status', ['organizationId', 'status'])
@Index('IDX_approval_requests_document', ['organizationId', 'documentType', 'documentId'])
export class ApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organizationId' })
  organizationId: string;

  @Column({ name: 'documentId', type: 'uuid' })
  documentId: string;

  @Column({ name: 'documentType' })
  documentType: string;

  @Column({ type: 'enum', enum: ApprovalStatus })
  status: ApprovalStatus;

  @Column({ name: 'currentStep', type: 'int' })
  currentStep: number;

  @Column({ name: 'policyId', type: 'uuid' })
  policyId: string;

  /**
   * Who asked for the approval.
   *
   * Without it there is no segregation of duties, and the entity did not have it. A user holding
   * the step's role could compose an entry and approve their own entry — which is the single
   * control an approval chain exists to provide, and the product had a chain that could not provide
   * it. `WorkflowsService.approve` refuses when this equals the approver.
   */
  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId: string | null;

  /** What the document was worth when it was submitted, which is what selected the steps. */
  @Column('decimal', { name: 'amount', precision: 18, scale: 2, default: 0 })
  amount: number;

  /** Set on the FINAL approval only; the per-step record is `approval_step_actions`. */
  @Column({ name: 'approvedByUserId', type: 'uuid', nullable: true })
  approvedByUserId?: string;

  @Column({ name: 'approvedAt', type: 'timestamp with time zone', nullable: true })
  approvedAt?: Date;

  @Column({ name: 'rejected_by_user_id', type: 'uuid', nullable: true })
  rejectedByUserId: string | null;

  @Column({ name: 'rejected_at', type: 'timestamp with time zone', nullable: true })
  rejectedAt: Date | null;

  @Column({ name: 'rejectionReason', nullable: true })
  rejectionReason?: string;

  /** Convenience for callers that switch on the document type. */
  get typedDocumentType(): DocumentTypeForApproval {
    return this.documentType as DocumentTypeForApproval;
  }
}
