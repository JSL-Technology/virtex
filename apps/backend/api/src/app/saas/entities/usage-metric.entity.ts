import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { SaasResource } from '../enums/saas-resource.enum';

@Entity('saas_usage_metrics')
@Index(['organizationId', 'resource', 'period'], { unique: true })
export class UsageMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Typed `uuid`, like every other tenant reference in the schema.
   *
   * It was declared without a type, so TypeORM inferred `character varying` from the TypeScript
   * `string` — the only tenant column in the database stored as text. That is not cosmetic: the
   * unique index below is what enforces plan limits, and under a text column two spellings of
   * the same identifier (upper- and lower-case hexadecimal are the same UUID, and Postgres
   * normalises them only for the `uuid` type) are two different rows. A tenant with two rows for
   * one resource is a tenant whose usage is counted twice over, each below its limit. The text
   * type also made a foreign key impossible, so metering rows for deleted tenants accumulated
   * with nothing to remove them.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: Organization;

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
