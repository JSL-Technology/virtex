import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BankStatement } from './bank-statement.entity';
import type { ReconciliationMatch } from './reconciliation-match.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

export enum TransactionStatus {
  UNMATCHED = 'UNMATCHED',
  MATCHED = 'MATCHED',
  /**
   * Deliberately set aside: a line the account holder has decided does not belong to these books
   * (a bank's own correction reversed on the next line, a duplicate the bank posted twice). It
   * takes no part in the balance proof and has to be justified.
   */
  EXCLUDED = 'EXCLUDED',
}

/**
 * One line of a bank statement.
 *
 * `debit` and `credit` are stated from **the account holder's** point of view, which is the ledger's:
 * `debit` is money arriving in the account and `credit` is money leaving it. A bank's own statement
 * uses the opposite convention — it is the bank's liability — so the import maps the columns rather
 * than copying them.
 *
 * ## What changed
 *
 * `matched_entry_line_id` was a single nullable column, so a bank line could match exactly one
 * ledger line. Neither of the two commonest cases fits that: a deposit of five cheques is one bank
 * line against five ledger lines, and a transfer whose fee the bank charged separately is one
 * ledger entry against two bank lines. Matching moved to `reconciliation_matches`, which is a
 * many-to-many with a balance check.
 */
@Entity({ name: 'bank_transactions' })
@Index('IDX_bank_transactions_statement', ['statementId'])
@Index('IDX_bank_transactions_match', ['matchId'])
export class BankTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'statement_id', type: 'uuid' })
  statementId: string;

  @ManyToOne('BankStatement', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'statement_id' })
  statement: BankStatement;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  /** The bank's own reference for the movement: cheque number, wire reference, terminal id. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  reference: string | null;

  /** Money into the account. */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  debit: number;

  /** Money out of the account. */
  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: numericTransformerNotNull,
  })
  credit: number;

  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.UNMATCHED })
  status: TransactionStatus;

  @Column({ name: 'match_id', type: 'uuid', nullable: true })
  matchId: string | null;

  @ManyToOne('ReconciliationMatch', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'match_id' })
  match: ReconciliationMatch | null;

  /** Why this line was set aside. Required to exclude one, so a closed statement stays auditable. */
  @Column({ name: 'exclusion_reason', type: 'text', nullable: true })
  exclusionReason: string | null;

  /** Line number in the uploaded file, so an import error can point at a row. */
  @Column({ name: 'source_row', type: 'int', nullable: true })
  sourceRow: number | null;
}
