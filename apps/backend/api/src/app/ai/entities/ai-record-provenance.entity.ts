import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { AiProvenanceFields, AiProvenanceSource } from '../../contracts/ai/provenance.contract';

/**
 * A record the AI proposed or filled in, and what stands behind it. Written through
 * `recordAiProvenance` (contracts/ai/provenance.contract.ts) by whichever module created the record.
 */
@Entity({ name: 'ai_record_provenance' })
@Unique('UQ_ai_record_provenance_record_source', ['organizationId', 'entityType', 'entityId', 'source'])
@Check(
  'CHK_ai_record_provenance_source',
  `"source" IN ('AI_COPILOT', 'AI_CAPTURE', 'AI_AGENT', 'AI_RECONCILIATION', 'AI_MAIL', 'AI_MCP')`,
)
export class AiRecordProvenance {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_ai_record_provenance' })
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_record_provenance_organization')
  organization?: TenantRef;

  @Column({ name: 'entity_type', type: 'varchar', length: 48 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ type: 'varchar', length: 24 })
  source: AiProvenanceSource;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'ai_request_id', type: 'uuid', nullable: true })
  aiRequestId: string | null;

  @Column({ name: 'pending_action_id', type: 'uuid', nullable: true })
  pendingActionId: string | null;

  @Column({ name: 'agent_run_id', type: 'uuid', nullable: true })
  agentRunId: string | null;

  /** For a captured document: the fields kept as the AI read them, and those a person corrected. */
  @Column({ type: 'jsonb', nullable: true })
  fields: AiProvenanceFields | null;

  @Column({ type: 'jsonb', default: {} })
  detail: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
