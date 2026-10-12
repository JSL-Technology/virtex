import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { WorkflowGraph, WorkflowTrigger } from '../contracts/workflow-graph';

export enum WorkflowDefinitionStatus {
  /** Editable. Cannot start instances. */
  DRAFT = 'DRAFT',
  /** The live version. At most one PUBLISHED per `key` per tenant. */
  PUBLISHED = 'PUBLISHED',
  /** A former PUBLISHED, kept so its running instances still resolve their definition. */
  ARCHIVED = 'ARCHIVED',
}

/**
 * A workflow design: a named, versioned process graph.
 *
 * `key` is the stable identity across versions; `version` increments as a published design is
 * revised. Instances pin the `definitionVersion` they started on, so editing and republishing a
 * process never rewrites the path of something already running — the control an auditor needs and
 * the one a live ERP cannot do without.
 */
@Entity({ name: 'workflow_definitions' })
@Index('IDX_workflow_definitions_org_key', ['organizationId', 'key'])
@Index('UQ_workflow_definitions_org_key_version', ['organizationId', 'key', 'version'], {
  unique: true,
})
export class WorkflowDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Stable slug shared by every version of this process. */
  @Column({ type: 'varchar', length: 120 })
  key: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({
    type: 'enum',
    enum: WorkflowDefinitionStatus,
    enumName: 'workflow_definition_status',
    default: WorkflowDefinitionStatus.DRAFT,
  })
  status: WorkflowDefinitionStatus;

  @Column({ type: 'jsonb', default: () => `'{"edges": [], "nodes": []}'` })
  graph: WorkflowGraph;

  @Column({ type: 'jsonb', default: () => `'{"mode": "manual"}'` })
  trigger: WorkflowTrigger;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @TenantOwned('FK_workflow_definitions_organization')
  organization?: TenantRef;
}
