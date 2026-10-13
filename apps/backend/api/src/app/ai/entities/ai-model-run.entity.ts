import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

export type AiModelRunKind = 'FORECAST' | 'ANOMALY';
export type AiModelRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type AiModelRunTrigger = 'SCHEDULED' | 'MANUAL' | 'EVENT';

/**
 * One execution of the forecasting or anomaly engine for one tenant.
 *
 * Every forecast and every anomaly points back at the run that produced it, and the run records the
 * engine version, the parameters, a hash of the data it read and the accuracy it measured. A figure
 * on a screen can therefore always be answered with "this run, on this data, with this model, and
 * this is how accurate it was" — which is the difference between a prediction someone can act on
 * and a number someone has to take on trust.
 */
@Entity({ name: 'ai_model_runs' })
@Index('IDX_ai_model_runs_org_kind_created', ['organizationId', 'kind', 'createdAt'])
export class AiModelRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @TenantOwned('FK_ai_model_runs_organization')
  organization?: TenantRef;

  @Column({ type: 'varchar', length: 16 })
  kind: AiModelRunKind;

  @Column({ type: 'varchar', length: 16, default: 'QUEUED' })
  status: AiModelRunStatus;

  @Column({ type: 'varchar', length: 16 })
  trigger: AiModelRunTrigger;

  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId: string | null;

  @Column({ name: 'engine_version', type: 'varchar', length: 32, nullable: true })
  engineVersion: string | null;

  @Column({ type: 'jsonb', default: {} })
  params: Record<string, unknown>;

  /** Backtest accuracy and run statistics, as the engine reported them. */
  @Column({ type: 'jsonb', nullable: true })
  metrics: Record<string, unknown> | null;

  @Column({ name: 'data_hash', type: 'char', length: 64, nullable: true })
  dataHash: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
