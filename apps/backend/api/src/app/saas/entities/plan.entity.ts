import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { PlanLimit } from './plan-limit.entity';
import { PlanFeature } from './plan-feature.entity';

@Entity('saas_plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slug: string; // starter, pro, enterprise

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'stripe_product_id', nullable: true })
  externalProductId: string;

  @Column({ name: 'monthly_price_id', nullable: true })
  monthlyPriceId: string;

  @Column({ name: 'annual_price_id', nullable: true })
  annualPriceId: string;

  @Column({ name: 'monthly_price', nullable: true, type: 'int' })
  monthlyPrice: number; // Display price in USD cents

  // Optional free-trial length applied at checkout. null/0 = charge immediately.
  // Lets us run trials/promotions per plan via config without code changes.
  @Column({ name: 'trial_period_days', nullable: true, type: 'int' })
  trialPeriodDays: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => PlanLimit, limit => limit.plan, { cascade: true })
  limits: PlanLimit[];

  @OneToMany(() => PlanFeature, feature => feature.plan, { cascade: true })
  features: PlanFeature[];
}
