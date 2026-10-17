import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { AiAnomaly } from './ai-anomaly.entity';

export type AiAnomalyVerdict = 'USEFUL' | 'FALSE_POSITIVE';

/**
 * What a person said about an anomaly.
 *
 * Kept as its own history rather than folded into the anomaly's status, because it is the training
 * signal: which detectors a tenant finds useful, at which thresholds. A detector whose findings are
 * dismissed as false positives again and again is a detector to quieten for that tenant.
 */
@Entity({ name: 'ai_anomaly_feedback' })
@Index('IDX_ai_anomaly_feedback_org_anomaly', ['organizationId', 'anomalyId'])
export class AiAnomalyFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_anomaly_feedback_organization')
  organization?: TenantRef;

  @Column({ name: 'anomaly_id', type: 'uuid' })
  anomalyId: string;

  @ManyToOne('AiAnomaly', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anomaly_id', foreignKeyConstraintName: 'FK_ai_anomaly_feedback_anomaly' })
  anomaly?: AiAnomaly;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  verdict: AiAnomalyVerdict;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
