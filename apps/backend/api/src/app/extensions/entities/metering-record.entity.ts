import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

export enum MeteringStatus {
  SUCCESS = 'success',
  FAILURE = 'failure',
}

/**
 * One usage record per extension execution, the basis for usage billing.
 *
 * Tenant-scoped, append-only. The sandbox reports back the resources an isolate actually consumed
 * (wall time, peak heap, number of egress calls); {@link BillingService} rolls these up per tenant
 * and per plugin over a period. Keeping a row per execution — rather than a running counter — is
 * what makes a reconciliation report auditable after the fact.
 */
@Entity({ name: 'plugin_metering_records' })
@Index('IDX_plugin_metering_org_ts', ['organizationId', 'timestamp'])
@Index('IDX_plugin_metering_org_plugin', ['organizationId', 'pluginId'])
export class MeteringRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organization_id',
    foreignKeyConstraintName: 'FK_plugin_metering_organization',
  })
  organization: Organization;

  /**
   * The plugin's NAME, not its id — a metering row outlives the catalogue entry it refers to, so
   * it holds a value rather than a foreign key. `character varying(255)`, matching `plugins.name`.
   */
  @Column({ length: 255 })
  pluginId: string;

  @Column({ length: 50, default: '0.0.0' })
  pluginVersion: string;

  @Column({ type: 'int', default: 0 })
  executionTimeMs: number;

  @Column({ type: 'bigint', default: 0 })
  memoryBytes: number;

  @Column({ type: 'int', default: 0 })
  egressCount: number;

  @Column({ type: 'enum', enum: MeteringStatus, default: MeteringStatus.SUCCESS })
  status: MeteringStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  timestamp: Date;
}
