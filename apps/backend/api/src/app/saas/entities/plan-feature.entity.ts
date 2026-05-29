import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import type { Plan } from './plan.entity';

@Entity('saas_plan_features')
export class PlanFeature {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  featureKey: string; // e.g., 'api_access', 'custom_domains'

  @Column({ default: true })
  isEnabled: boolean;

  @ManyToOne('Plan', 'features', { onDelete: 'CASCADE' })
  plan: Plan;
}
