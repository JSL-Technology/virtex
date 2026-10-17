import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';
import type { AiModelRun } from './ai-model-run.entity';

export type AiCashflowItemKind = 'RECEIVABLE' | 'PAYABLE';

/**
 * An open invoice or bill in the projection, with when its money is likely to move: the chance it
 * is collected (or paid) within 7 days, within 30, within the horizon, and the median date.
 * "Doubtful": later already than anything this customer or company has ever paid.
 */
@Entity({ name: 'ai_cashflow_items' })
@Index('IDX_ai_cashflow_items_org_run_kind', ['organizationId', 'runId', 'kind'])
export class AiCashflowItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_cashflow_items_organization')
  organization?: TenantRef;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne('AiModelRun', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id', foreignKeyConstraintName: 'FK_ai_cashflow_items_run' })
  run?: AiModelRun;

  @Column({ type: 'varchar', length: 16 })
  kind: AiCashflowItemKind;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ name: 'party_id', type: 'uuid', nullable: true })
  partyId: string | null;

  @Column({ name: 'party_name', type: 'varchar', length: 300, default: '' })
  partyName: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  number: string | null;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  amount: number;

  @Column({ name: 'expected_date', type: 'date', nullable: true })
  expectedDate: string | null;

  @Column({ name: 'p_by_7', type: 'numeric', precision: 6, scale: 4, transformer: numericTransformerNotNull })
  pBy7: number;

  @Column({ name: 'p_by_30', type: 'numeric', precision: 6, scale: 4, transformer: numericTransformerNotNull })
  pBy30: number;

  @Column({ name: 'p_in_horizon', type: 'numeric', precision: 6, scale: 4, transformer: numericTransformerNotNull })
  pInHorizon: number;

  @Column({ type: 'boolean', default: false })
  doubtful: boolean;
}
