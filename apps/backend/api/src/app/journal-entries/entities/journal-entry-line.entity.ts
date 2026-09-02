
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import type { JournalEntry } from './journal-entry.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { JournalEntryLineValuation } from './journal-entry-line-valuation.entity';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';

@Entity({ name: 'journal_entry_lines' })
@Index('IDX_journal_entry_lines_account', ['accountId'])
export class JournalEntryLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('JournalEntry', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntry;

  @ManyToOne(() => Account, { nullable: false, eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'account_id' })
  accountId: string;


  @Column('decimal', { precision: 18, scale: 2, default: 0.00, comment: 'Amount in base currency for the primary ledger', transformer: numericTransformerNotNull })
  debit: number;

  @Column('decimal', { precision: 18, scale: 2, default: 0.00, comment: 'Amount in base currency for the primary ledger', transformer: numericTransformerNotNull })
  credit: number;
  

  @Column('decimal', { precision: 18, scale: 2, nullable: true, name: 'foreign_currency_debit', transformer: numericTransformer })
  foreignCurrencyDebit?: number;

  @Column('decimal', { precision: 18, scale: 2, nullable: true, name: 'foreign_currency_credit', transformer: numericTransformer })
  foreignCurrencyCredit?: number;

  @Column({ length: 3, nullable: true, name: 'currency_code' })
  currencyCode?: string;

  @Column('decimal', { precision: 18, scale: 6, nullable: true, name: 'exchange_rate', transformer: numericTransformer })
  exchangeRate?: number;

  @Column({ type: 'text', nullable: true })
  description?: string;
  
  @Column({ type: 'jsonb', nullable: true, name: 'dimensions' })
  dimensions?: Record<string, string>;


  @OneToMany(() => JournalEntryLineValuation, valuation => valuation.journalEntryLine, { cascade: true, eager: true })
  valuations: JournalEntryLineValuation[];


  @Column({ name: 'is_reconciled', default: false, comment: 'Indicates if the line has been reconciled against a bank statement.' })
  isReconciled: boolean;

  /**
   * When it was cleared, and against what.
   *
   * `isReconciled` alone was a boolean nothing could explain: it said a line had been reconciled at
   * some point, by nobody, against nothing, and no operation ever cleared it again. The match id is
   * the audit trail — and the thing that lets a match be undone without leaving the flag stranded.
   */
  @Column({ name: 'reconciled_at', type: 'timestamptz', nullable: true })
  reconciledAt: Date | null;
}