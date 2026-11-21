import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Organization } from './organization.entity';
import { Plan } from '../../saas/entities/plan.entity';
import type { PlanChangeReason } from '../../saas/plan-change';

/**
 * One row per change of an organization's plan: from what, to what, why and by whom.
 *
 * Written by `SaasService.applyPlan` and by nothing else, in the same transaction as the change it
 * records, so the history cannot say one thing while the organization says another.
 */
@Entity('organization_subscription_history')
export class OrganizationSubscriptionHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** `null` for the first plan an organization ever had. */
  @Column({ name: 'previous_plan_id', type: 'uuid', nullable: true })
  previousPlanId: string | null;

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'previous_plan_id' })
  previousPlan?: Plan;

  @Column({ name: 'new_plan_id', type: 'uuid' })
  newPlanId: string;

  @ManyToOne(() => Plan)
  @JoinColumn({ name: 'new_plan_id' })
  newPlan: Plan;

  @Column({ name: 'reason', type: 'varchar', nullable: true })
  reason: PlanChangeReason | null;

  /** The user who caused the change; `null` when the payment provider did. */
  @Column({ name: 'changed_by', type: 'varchar', nullable: true })
  changedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
