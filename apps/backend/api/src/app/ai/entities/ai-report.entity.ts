import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

export type AiReportKind = 'CASHFLOW_PLAN' | 'MANAGER_MONTHLY' | 'SCENARIO_COMPARISON';
export type AiReportStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
/**
 * Who may read a report. `REQUESTER`: written with the requester's own permissions and branches,
 * for them alone. `ORGANIZATION`: written for the whole company, for those who hold every source
 * permission and see every branch.
 */
export type AiReportAudience = 'REQUESTER' | 'ORGANIZATION';

/**
 * A text a model wrote from facts the API assembled — the cash plan, the manager's monthly report,
 * a scenario comparison. Kept with the exact facts it was written from, so every figure it states
 * can be traced, and generated in the background: a long analysis is not a request to wait on.
 */
@Entity({ name: 'ai_reports' })
@Check('CHK_ai_reports_audience', `"audience" IN ('REQUESTER', 'ORGANIZATION')`)
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

  @Column({ type: 'varchar', length: 16, default: 'REQUESTER' })
  audience: AiReportAudience;

  /** Every permission guarding a source the facts came from; reading the report requires all of them. */
  @Column({ name: 'required_permissions', type: 'jsonb', default: [] })
  requiredPermissions: string[];

  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
