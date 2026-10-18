import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { WorkflowSubject, WorkflowToken } from '../contracts/workflow-graph';

export enum WorkflowInstanceStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  /** A node failed irrecoverably (a missing action, a dead-end). Carries the reason in `error`. */
  FAILED = 'FAILED',
}

/**
 * One running (or finished) execution of a {@link WorkflowDefinition}.
 *
 * `context` is the instance's memory — the variables conditions read and actions write. `tokens`
 * are the live points of execution (see {@link WorkflowToken}). `nextWakeAt` is the earliest moment
 * a parked timer token is due, denormalised out of `tokens` so the sweep can find due instances with
 * an index instead of scanning JSON.
 */
@Entity({ name: 'workflow_instances' })
@Index('IDX_workflow_instances_org_status', ['organizationId', 'status'])
@Index('IDX_workflow_instances_org_wake', ['organizationId', 'nextWakeAt'])
@Index('IDX_workflow_instances_org_definition', ['organizationId', 'definitionId'])
// `created_at DESC` in the migration; TypeORM cannot express the direction, only the columns.
@Index('IDX_workflow_instances_org_created', ['organizationId', 'createdAt'])
@Index('IDX_workflow_instances_parent', ['organizationId', 'parentInstanceId'], { where: '"parent_instance_id" IS NOT NULL' })
export class WorkflowInstance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'definition_id', type: 'uuid' })
  definitionId: string;

  @Column({ name: 'definition_version', type: 'int' })
  definitionVersion: number;

  @Column({
    type: 'enum',
    enum: WorkflowInstanceStatus,
    enumName: 'workflow_instance_status',
    default: WorkflowInstanceStatus.RUNNING,
  })
  status: WorkflowInstanceStatus;

  @Column({ type: 'jsonb', default: {} })
  context: Record<string, unknown>;

  @Column({ type: 'jsonb', default: [] })
  tokens: WorkflowToken[];

  @Column({ type: 'jsonb', nullable: true })
  subject: WorkflowSubject | null;

  @Column({ name: 'started_by_user_id', type: 'uuid', nullable: true })
  startedByUserId: string | null;

  @Column({ name: 'next_wake_at', type: 'timestamptz', nullable: true })
  nextWakeAt: Date | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** How it ended: the name of the end node reached («Aprobado», «Rechazado»). */
  @Column({ type: 'varchar', length: 200, nullable: true })
  result: string | null;

  /** Why someone cancelled it, kept with the run. */
  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;

  /** The run that started this one as a subprocess, if any. */
  @Column({ name: 'parent_instance_id', type: 'uuid', nullable: true })
  parentInstanceId: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @TenantOwned('FK_workflow_instances_organization')
  organization?: TenantRef;
}
