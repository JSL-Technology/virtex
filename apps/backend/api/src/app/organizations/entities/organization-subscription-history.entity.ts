import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Organization } from './organization.entity';
import { Plan } from '../../saas/entities/plan.entity';

@Entity('organization_subscription_history')
export class OrganizationSubscriptionHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'previous_plan_id', nullable: true })
  previousPlanId?: string;

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'previous_plan_id' })
  previousPlan?: Plan;

  @Column({ name: 'new_plan_id' })
  newPlanId: string;

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'new_plan_id' })
  newPlan: Plan;

  @Column({ name: 'reason', nullable: true })
  reason?: string; // e.g., 'upgrade', 'downgrade', 'initial'

  @Column({ name: 'changed_by', nullable: true })
  changedBy?: string; // User ID

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
