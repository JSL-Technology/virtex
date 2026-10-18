import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { AgentProposal } from '../../contracts/ai/agent-runs.contract';

/** One run of an agent: what it did, what it proposed, why it skipped what it skipped. */
@Entity({ name: 'ai_agent_runs' })
@Index('IDX_ai_agent_runs_org_agent_started', ['organizationId', 'agent', 'startedAt'])
@Check('CHK_ai_agent_runs_trigger', `"trigger" IN ('SCHEDULED', 'MANUAL', 'WORKFLOW')`)
@Check('CHK_ai_agent_runs_status', `"status" IN ('SUCCEEDED', 'FAILED', 'NOTHING_TO_DO')`)
export class AiAgentRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_agent_runs_organization')
  organization?: TenantRef;

  @Column({ type: 'varchar', length: 48 })
  agent: string;

  @Column({ type: 'varchar', length: 16 })
  trigger: 'SCHEDULED' | 'MANUAL' | 'WORKFLOW';

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 16 })
  status: 'SUCCEEDED' | 'FAILED' | 'NOTHING_TO_DO';

  @Column({ type: 'jsonb', default: {} })
  summary: Record<string, number | string | null>;

  @Column({ type: 'jsonb', default: [] })
  proposals: AgentProposal[];

  @Column({ type: 'jsonb', default: [] })
  notes: Array<{ key: string; params?: Record<string, unknown> }>;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', default: () => 'now()' })
  finishedAt: Date;
}
