import { Entity, PrimaryGeneratedColumn, Column, Index, UpdateDateColumn } from 'typeorm';
import { SaasResource } from '../enums/saas-resource.enum';

@Entity('saas_usage_metrics')
@Index(['organizationId', 'resource', 'period'], { unique: true })
export class UsageMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({
    type: 'enum',
    enum: SaasResource,
  })
  resource: SaasResource;

  @Column({ default: 0 })
  count: number;

  @Column({ nullable: true })
  period: string; // '2023-10' for monthly, or 'lifetime'

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
