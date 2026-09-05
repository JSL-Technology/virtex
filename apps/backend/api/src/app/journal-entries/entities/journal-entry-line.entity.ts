
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

@Index('IDX_journal_entry_lines_entry', ['journalEntryId'])
@Entity({ name: 'journal_entry_lines' })
@Index('IDX_journal_entry_lines_account', ['accountId'])
export class JournalEntryLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * `nullable: false`, and indexed.
   *
   * The column was nullable and carried no index. Both mattered: every balance, every report and
   * every ledger card joins a line to its entry to read the entry's status, its date and its
   * tenant, and without an index that join is a sequential scan of every line in the database. And
   * a nullable foreign key means an orphan line is storable — a line belonging to no entry, which
   * no status filter can exclude because it has no status to filter on, sitting in the account's
   * balance forever.
   */
  @ManyToOne('JournalEntry', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntry;

  @Column({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId: string;

  /**
   * Not eager.
   *
   * `JournalEntry.lines` is eager, so reading one entry loaded every line, and every line loaded a
   * full account — which in turn loaded that account's segments, also eager. Reading a hundred
   * entries fetched several thousand rows to render figures that come from the line itself. The
   * two readers that genuinely need the account (`ReportsService`, the general ledger) join it
   * explicitly.
   */
  @ManyToOne(() => Account, { nullable: false, onDelete: 'CASCADE' })
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