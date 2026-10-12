import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

export enum WorkflowTaskStatus {
  OPEN = 'OPEN',
  COMPLETED = 'COMPLETED',
  /** Closed without a decision because its instance was cancelled. */
  CANCELLED = 'CANCELLED',
}

/**
 * A human work item: what a token at a TASK or APPROVAL node is waiting on.
 *
 * It names who may act — a role, or a specific user — and the outcomes they may choose, each of
 * which routes the flow down a different edge. Completing it is what moves the parked token on, so a
 * task is the join between the people doing the work and the engine advancing it.
 */
@Entity({ name: 'workflow_tasks' })
@Index('IDX_workflow_tasks_org_status', ['organizationId', 'status'])
@Index('IDX_workflow_tasks_org_instance', ['organizationId', 'instanceId'])
@Index('IDX_workflow_tasks_org_role', ['organizationId', 'assigneeRoleId'])
export class WorkflowTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'instance_id', type: 'uuid' })
  instanceId: string;

  /** The graph node this task realises. */
  @Column({ name: 'node_id', type: 'varchar', length: 64 })
  nodeId: string;

  /** The token parked on the node, moved on when the task completes. */
  @Column({ name: 'token_id', type: 'varchar', length: 64 })
  tokenId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ name: 'assignee_role_id', type: 'uuid', nullable: true })
  assigneeRoleId: string | null;

  @Column({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId: string | null;

  /** The outcomes the actor may pick; each matches an outgoing edge. */
  @Column({ type: 'jsonb' })
  outcomes: string[];

  @Column({
    type: 'enum',
    enum: WorkflowTaskStatus,
    enumName: 'workflow_task_status',
    default: WorkflowTaskStatus.OPEN,
  })
  status: WorkflowTaskStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  outcome: string | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ name: 'completed_by_user_id', type: 'uuid', nullable: true })
  completedByUserId: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  /** What the actor filled in on completion, merged into the instance context. */
  @Column({ name: 'form_data', type: 'jsonb', nullable: true })
  formData: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @TenantOwned('FK_workflow_tasks_organization')
  organization?: TenantRef;
}
