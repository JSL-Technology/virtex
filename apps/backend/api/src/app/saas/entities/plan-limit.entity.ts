import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Plan } from './plan.entity';
import { SaasResource } from '../enums/saas-resource.enum';
import { QuotaPeriod } from '../enums/quota-period.enum';

export enum LimitType {
  NUMERIC = 'NUMERIC',
  BOOLEAN = 'BOOLEAN',
}

@Entity('saas_plan_limits')
export class PlanLimit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: SaasResource,
  })
  resource: SaasResource;

  @Column({
    type: 'enum',
    enum: LimitType,
    default: LimitType.NUMERIC,
  })
  valueType: LimitType;

  @Column({ type: 'int', default: 0 })
  limit: number; // -1 for unlimited, 0/1 for boolean if preferred, but isEnabled handles boolean better or just limit=1

  @Column({ name: 'is_unlimited', default: false })
  isUnlimited: boolean;

  @Column({ name: 'is_enabled', default: true })
  isEnabled: boolean; // For Boolean limits (Feature Flags)

  @Column({
    type: 'enum',
    enum: QuotaPeriod,
    default: QuotaPeriod.MONTHLY,
  })
  period: QuotaPeriod;

  @Column({ name: 'allow_overage', default: false })
  allowOverage: boolean;

  @Column({ name: 'plan_id' })
  planId: string;

  @ManyToOne(() => Plan, (plan) => plan.limits)
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;
}
