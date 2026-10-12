import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

/** What happened at one step of an instance. The `kind` is the verb; `detail` carries the specifics. */
export type WorkflowTransitionKind =
  | 'started'
  | 'enter'
  | 'action'
  | 'condition'
  | 'task_created'
  | 'task_completed'
  | 'timer_set'
  | 'timer_fired'
  | 'completed'
  | 'cancelled'
  | 'error';

/**
 * The instance's history, one row per step.
 *
 * It is append-only and read for the runtime view's timeline and for audit: who moved the token,
 * from where to where, and why. The engine writes it as it advances, so a finished instance can be
 * read back move by move without reconstructing anything.
 */
@Entity({ name: 'workflow_transitions' })
@Index('IDX_workflow_transitions_org_instance', ['organizationId', 'instanceId'])
export class WorkflowTransition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'instance_id', type: 'uuid' })
  instanceId: string;

  @Column({ name: 'from_node_id', type: 'varchar', length: 64, nullable: true })
  fromNodeId: string | null;

  @Column({ name: 'to_node_id', type: 'varchar', length: 64, nullable: true })
  toNodeId: string | null;

  @Column({ type: 'varchar', length: 32 })
  kind: WorkflowTransitionKind;

  @Column({ type: 'jsonb', nullable: true })
  detail: Record<string, unknown> | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @TenantOwned('FK_workflow_transitions_organization')
  organization?: TenantRef;
}
