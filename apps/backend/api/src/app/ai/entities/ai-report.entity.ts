import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

export type AiReportKind = 'CASHFLOW_PLAN' | 'MANAGER_MONTHLY' | 'SCENARIO_COMPARISON';
export type AiReportStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/**
 * A text a model wrote from facts the API assembled — the cash plan, the manager's monthly report,
 * a scenario comparison. Kept with the exact facts it was written from, so every figure it states
 * can be traced, and generated in the background: a long analysis is not a request to wait on.
 */
@Entity({ name: 'ai_reports' })
@Index('IDX_ai_reports_org_kind_created', ['organizationId', 'kind', 'createdAt'])
export class AiReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_reports_organization')
  organization?: TenantRef;

  @Column({ type: 'varchar', length: 32 })
  kind: AiReportKind;

  @Column({ type: 'varchar', length: 16, default: 'QUEUED' })
  status: AiReportStatus;

  /** The month a monthly report covers, `YYYY-MM`. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  period: string | null;

  @Column({ name: 'source_run_id', type: 'uuid', nullable: true })
  sourceRunId: string | null;

  @Column({ type: 'varchar', length: 8, default: 'es' })
  language: string;

  @Column({ type: 'jsonb', nullable: true })
  facts: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  content: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
