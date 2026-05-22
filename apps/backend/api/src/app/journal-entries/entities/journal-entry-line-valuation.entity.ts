
import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { JournalEntryLine } from './journal-entry-line.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';

@Entity({ name: 'journal_entry_line_valuations' })
export class JournalEntryLineValuation {
  @PrimaryColumn({ type: 'uuid', name: 'journal_entry_line_id' })
  journalEntryLineId: string;

  @PrimaryColumn({ type: 'uuid', name: 'ledger_id' })
  ledgerId: string;

  @ManyToOne(() => JournalEntryLine, line => line.valuations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_line_id' })
  journalEntryLine: JournalEntryLine;

  @ManyToOne(() => Ledger, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ledger_id' })
  ledger: Ledger;

  @Column('decimal', { precision: 18, scale: 2, comment: 'Debit amount in the context of the specified ledger' })
  debit: number;

  @Column('decimal', { precision: 18, scale: 2, comment: 'Credit amount in the context of the specified ledger' })
  credit: number;
}