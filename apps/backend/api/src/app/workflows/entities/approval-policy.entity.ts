
import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { ApprovalPolicyStep } from './approval-policy-step.entity';

export enum DocumentTypeForApproval {
  VENDOR_BILL = 'VENDOR_BILL',
  PAYMENT_BATCH = 'PAYMENT_BATCH',
  JOURNAL_ENTRY = 'JOURNAL_ENTRY',
  PERIOD_REOPENING = 'PERIOD_REOPENING',
  AUDIT_ADJUSTMENT = 'AUDIT_ADJUSTMENT',
}

@Entity({ name: 'approval_policies' })
export class ApprovalPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  organizationId: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: DocumentTypeForApproval })
  documentType: DocumentTypeForApproval;

  @OneToMany(() => ApprovalPolicyStep, (step) => step.policy, { cascade: true })
  steps: ApprovalPolicyStep[];
}