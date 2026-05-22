
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { JournalEntry } from './journal-entry.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { JournalEntryLineValuation } from './journal-entry-line-valuation.entity';

@Entity({ name: 'journal_entry_lines' })
export class JournalEntryLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => JournalEntry, (journalEntry) => journalEntry.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntry;

  @ManyToOne(() => Account, { nullable: false, eager: true })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'account_id' })
  accountId: string;


  @Column('decimal', { precision: 18, scale: 2, default: 0.00, comment: 'Amount in base currency for the primary ledger' })
  debit: number;

  @Column('decimal', { precision: 18, scale: 2, default: 0.00, comment: 'Amount in base currency for the primary ledger' })
  credit: number;
  

  @Column('decimal', { precision: 18, scale: 2, nullable: true, name: 'foreign_currency_debit' })
  foreignCurrencyDebit?: number;

  @Column('decimal', { precision: 18, scale: 2, nullable: true, name: 'foreign_currency_credit' })
  foreignCurrencyCredit?: number;

  @Column({ length: 3, nullable: true, name: 'currency_code' })
  currencyCode?: string;

  @Column('decimal', { precision: 18, scale: 6, nullable: true, name: 'exchange_rate' })
  exchangeRate?: number;

  @Column({ type: 'text', nullable: true })
  description?: string;
  
  @Column({ type: 'jsonb', nullable: true, name: 'dimensions' })
  dimensions?: Record<string, string>;


  @OneToMany(() => JournalEntryLineValuation, valuation => valuation.journalEntryLine, { cascade: true, eager: true })
  valuations: JournalEntryLineValuation[];


  @Column({ name: 'is_reconciled', default: false, comment: 'Indicates if the line has been reconciled against a bank statement.' })
  isReconciled: boolean;
}