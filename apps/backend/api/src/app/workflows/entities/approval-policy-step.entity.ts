import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ApprovalPolicy } from './approval-policy.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

// The steps of a policy are traversed in `order`; two steps sharing one makes the traversal depend
// on row order, which is not a chain. Partial because a step with no policy is orphaned data the
// constraint has nothing to say about.
@Index('IDX_approval_policy_steps_policy_order', ['policyId', 'order'], {
  unique: true,
  where: '"policyId" IS NOT NULL',
})
@Entity({ name: 'approval_policy_steps' })
export class ApprovalPolicyStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('ApprovalPolicy', 'steps', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'policyId' })
  policy: ApprovalPolicy;

  @Column({ name: 'policyId', type: 'uuid', nullable: true })
  policyId: string | null;

  /** Position in the chain. Steps are evaluated in this order, never in insertion order. */
  @Column({ name: 'order', type: 'int' })
  order: number;

  /**
   * The amount at or above which this step applies.
   *
   * Declared `decimal` and read without a transformer, so it arrived in JavaScript as the string
   * `"500.00"` and every threshold comparison was an implicit coercion. It happened to work because
   * `1000 >= "500.00"` coerces; it would stop working the moment a locale-formatted value reached
   * the column, and a monetary threshold compared by coercion is not a threshold.
   */
  @Column('decimal', {
    name: 'minAmount',
    precision: 12,
    scale: 2,
    transformer: numericTransformerNotNull,
  })
  minAmount: number;

  @Column({ name: 'roleId', type: 'uuid' })
  roleId: string;
}
