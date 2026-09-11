import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

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
@Index(['organizationId', 'timestamp'])
@Index(['organizationId', 'pluginId'])
export class MeteringRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  organizationId: string;

  @Column()
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

  @CreateDateColumn()
  timestamp: Date;
}
