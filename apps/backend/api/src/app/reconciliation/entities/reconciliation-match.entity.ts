import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import type { BankStatement } from './bank-statement.entity';
import type { BankTransaction } from './bank-transaction.entity';
import type { ReconciliationMatchLine } from './reconciliation-match-line.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

export enum MatchOrigin {
  /** A person confirmed it. */
  MANUAL = 'MANUAL',
  /** A rule proposed it and it balanced. */
  RULE = 'RULE',
  /** The matcher found exactly one candidate and it balanced. */
  AUTOMATIC = 'AUTOMATIC',
}

/**
 * The join between statement lines and ledger lines.
 *
 * ## Why this table exists
 *
 * Reconciliation used to be a single nullable column on `bank_transactions`, so it could only
 * express one bank line against one ledger line. Both of the everyday cases are many-to-many: a
 * deposit of several cheques is one bank line against several ledger lines, and a transfer whose
 * fee the bank charged separately is one ledger entry against two bank lines.
 *
 * A match is only valid when the two sides balance to the cent, which is the invariant the service
 * enforces before writing one. That is also what makes the balance proof computable: everything not
 * in a match is, by definition, an item in transit on one side or the other.
 */
@Entity({ name: 'reconciliation_matches' })
@Index('IDX_reconciliation_matches_statement', ['statementId'])
export class ReconciliationMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'statement_id', type: 'uuid' })
  statementId: string;

  @ManyToOne('BankStatement', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'statement_id' })
  statement: BankStatement;

  /** Signed: positive when the movement is money into the account. */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    transformer: numericTransformerNotNull,
  })
  amount: number;

  @Column({ type: 'enum', enum: MatchOrigin, default: MatchOrigin.MANUAL })
  origin: MatchOrigin;

  /** The rule that proposed it, when one did. */
  @Column({ name: 'rule_id', type: 'uuid', nullable: true })
  ruleId: string | null;

  @Column({ name: 'matched_by_user_id', type: 'uuid', nullable: true })
  matchedByUserId: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany('BankTransaction', (transaction: BankTransaction) => transaction.match)
  transactions: BankTransaction[];

  @OneToMany('ReconciliationMatchLine', (line: ReconciliationMatchLine) => line.match, {
    cascade: true,
  })
  lines: ReconciliationMatchLine[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
