import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import type { AiModelRun } from './ai-model-run.entity';

export type AiAnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AiAnomalyStatus = 'OPEN' | 'CONFIRMED' | 'DISMISSED';

/**
 * Something in the books or the stock that does not look like the rest.
 *
 * `detector` names what found it — a rule (`rule.duplicate_vendor_bill`), a series model
 * (`timeseries.demand_residual`), an outlier model (`outlier.isolation_forest`) or a forensic test
 * (`forensic.benford`). `evidence` is the structured reason, which the screen renders through
 * translation keys; `explanation` is an optional plain-language narrative written FROM that
 * evidence, never in place of it.
 *
 * `fingerprint` identifies the finding itself: the same duplicate bill reported by tomorrow's run
 * updates this row rather than raising a second alert, and a finding someone dismissed stays
 * dismissed.
 */
@Entity({ name: 'ai_anomalies' })
@Index('UQ_ai_anomalies_org_fingerprint', ['organizationId', 'fingerprint'], { unique: true })
@Index('IDX_ai_anomalies_org_status_occurred', ['organizationId', 'status', 'occurredOn'])
export class AiAnomaly {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_anomalies_organization')
  organization?: TenantRef;

  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId: string | null;

  @ManyToOne('AiModelRun', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'run_id', foreignKeyConstraintName: 'FK_ai_anomalies_run' })
  run?: AiModelRun | null;

  @Column({ type: 'varchar', length: 48 })
  detector: string;

  /** The area it concerns: `sales`, `purchases`, `inventory`, `cash`. */
  @Column({ type: 'varchar', length: 32 })
  category: string;

  @Column({ type: 'varchar', length: 16 })
  severity: AiAnomalySeverity;

  /** 0 to 1: how unusual, on the detector's own scale, normalised. */
  @Column({ type: 'decimal', precision: 9, scale: 6, default: 0, transformer: numericTransformerNotNull })
  score: number;

  /** The kind of record it points at (`vendor_bill`, `invoice`, `pos_sale`, `product`…). */
  @Column({ name: 'entity_type', type: 'varchar', length: 48 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'occurred_on', type: 'date' })
  occurredOn: string;

  @Column({ type: 'varchar', length: 128 })
  fingerprint: string;

  @Column({ type: 'jsonb', default: {} })
  evidence: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  explanation: string | null;

  @Column({ type: 'varchar', length: 16, default: 'OPEN' })
  status: AiAnomalyStatus;

  @Column({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
