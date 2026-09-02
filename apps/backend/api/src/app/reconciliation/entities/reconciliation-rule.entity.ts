import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { numericTransformer } from '../../common/database/numeric.transformer';

export enum RuleConditionField {
  DESCRIPTION = 'DESCRIPTION',
  REFERENCE = 'REFERENCE',
  AMOUNT = 'AMOUNT',
}

export enum RuleConditionOperator {
  CONTAINS = 'CONTAINS',
  EQUALS = 'EQUALS',
  STARTS_WITH = 'STARTS_WITH',
  ENDS_WITH = 'ENDS_WITH',
}

/** Which side of the account a rule applies to. */
export enum RuleDirection {
  ANY = 'ANY',
  MONEY_IN = 'MONEY_IN',
  MONEY_OUT = 'MONEY_OUT',
}

export enum RuleAction {
  /**
   * Find the ledger line this statement line already corresponds to and clear both.
   *
   * The default, and the only safe one for anything the business originated: a customer receipt and
   * a supplier payment are already in the ledger, and posting a second entry for them double-counts
   * the cash.
   */
  MATCH_EXISTING = 'MATCH_EXISTING',
  /**
   * Post the entry the books are missing.
   *
   * Only for movements the **bank** originated and nobody recorded: a maintenance charge, interest
   * credited, a tax on transactions. The service applies it exclusively when no candidate ledger
   * line exists, so a rule cannot duplicate a movement the books already carry.
   */
  CREATE_ENTRY = 'CREATE_ENTRY',
}

/**
 * A standing instruction for what to do with a recognisable statement line.
 *
 * ## What this was
 *
 * The entity existed, no endpoint could create one, and `autoReconcileStatement` therefore iterated
 * an empty list on every run — the feature was unreachable. Worse, the branch it never reached
 * **posted a new journal entry** for every match and then marked the statement line reconciled
 * against the line it had just created. Had a rule ever existed, every customer receipt and
 * supplier payment appearing on a statement would have been counted twice: once when it was
 * recorded, and again when the statement arrived.
 *
 * Rules are tenant-scoped (`organization_id` was an unconstrained `character varying` with no
 * foreign key and no index), ordered by priority, deactivatable, and now say explicitly whether
 * they match something that exists or record something that does not.
 */
@Entity({ name: 'reconciliation_rules' })
@Index('IDX_reconciliation_rules_org', ['organizationId'])
export class ReconciliationRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'condition_field', type: 'enum', enum: RuleConditionField })
  conditionField: RuleConditionField;

  @Column({ name: 'condition_operator', type: 'enum', enum: RuleConditionOperator })
  conditionOperator: RuleConditionOperator;

  @Column({ name: 'condition_value', type: 'varchar', length: 255 })
  conditionValue: string;

  @Column({ type: 'enum', enum: RuleDirection, default: RuleDirection.ANY })
  direction: RuleDirection;

  /** Narrows the rule to a band, so "commission" at 25 is not the same rule as at 25,000. */
  @Column({
    name: 'amount_min',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  amountMin: number | null;

  @Column({
    name: 'amount_max',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  amountMax: number | null;

  @Column({ type: 'enum', enum: RuleAction, default: RuleAction.MATCH_EXISTING })
  action: RuleAction;

  /** Where a `CREATE_ENTRY` rule books the other side. Unused by a matching rule. */
  @Column({ name: 'target_account_id', type: 'uuid', nullable: true })
  targetAccountId: string | null;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'target_account_id' })
  targetAccount: Account | null;

  /** Lower runs first. Ties break on creation order. */
  @Column({ type: 'int', default: 100 })
  priority: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
