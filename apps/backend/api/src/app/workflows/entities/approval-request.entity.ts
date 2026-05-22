
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity({ name: 'approval_requests' })
export class ApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column()
  organizationId: string;

  @Column({ type: 'uuid' })
  documentId: string;

  @Column()
  documentType: string;

  @Column({ type: 'enum', enum: ApprovalStatus })
  status: ApprovalStatus;
  
  @Column({ type: 'int' })
  currentStep: number;
  
  @Column({ type: 'uuid' })
  policyId: string;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId?: string;
  
  @Column({ type: 'timestamp with time zone', nullable: true })
  approvedAt?: Date;

  @Column({ nullable: true })
  rejectionReason?: string;
}