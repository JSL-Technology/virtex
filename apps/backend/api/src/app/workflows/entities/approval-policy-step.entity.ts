
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { ApprovalPolicy } from './approval-policy.entity';

@Entity({ name: 'approval_policy_steps' })
export class ApprovalPolicyStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ApprovalPolicy, (policy) => policy.steps)
  policy: ApprovalPolicy;

  @Column({ type: 'int' })
  order: number;

  @Column('decimal', { precision: 12, scale: 2 })
  minAmount: number;

  @Column({ type: 'uuid' })
  roleId: string;
}