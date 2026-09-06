import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApprovalRequest } from './approval-request.entity';

export enum ApprovalDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * One decision by one person on one step of an approval chain.
 *
 * ## Why the request alone was not a record
 *
 * `approval_requests` carried a single `approved_by_user_id`, and `WorkflowsService.approve` only
 * set it on the LAST step. In a two- or three-step policy — which is the entire reason to have
 * steps — the intermediate approvers left no trace at all: not who, not when, not on which step.
 * The chain of authority a multi-step policy exists to create could not be reconstructed
 * afterwards, which is the one thing an auditor asks it for. `reject` recorded even less: it took
 * no user, so a rejection was attributable to nobody.
 *
 * A row per decision, written in the same transaction as the decision itself.
 */
@Entity({ name: 'approval_step_actions' })
@Index('IDX_approval_step_actions_request', ['requestId'])
export class ApprovalStepAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ApprovalRequest, { nullable: false, onDelete: 'CASCADE' })
  // Named, because the migration names it. An unnamed relation gets TypeORM's hash-derived name,
  // and the two disagreeing is drift the schema check reports on every run.
  @JoinColumn({
    name: 'request_id',
    foreignKeyConstraintName: 'FK_approval_step_actions_request',
  })
  request: ApprovalRequest;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** Which step of the policy this decision resolved. */
  @Column({ name: 'step_order', type: 'int' })
  stepOrder: number;

  /** The role the decision was made under, so a later role change cannot rewrite history. */
  @Column({ name: 'role_id', type: 'uuid', nullable: true })
  roleId: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId: string;

  @Column({ type: 'enum', enum: ApprovalDecision })
  decision: ApprovalDecision;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
