
import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type { JournalEntryLine } from './journal-entry-line.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

@Index('IDX_journal_entry_line_valuations_ledger', ['ledgerId'])
@Entity({ name: 'journal_entry_line_valuations' })
export class JournalEntryLineValuation {
  @PrimaryColumn({ type: 'uuid', name: 'journal_entry_line_id' })
  journalEntryLineId: string;

  @PrimaryColumn({ type: 'uuid', name: 'ledger_id' })
  ledgerId: string;

  @ManyToOne('JournalEntryLine', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_line_id' })
  journalEntryLine: JournalEntryLine;

  @ManyToOne(() => Ledger, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ledger_id' })
  ledger: Ledger;

  @Column('decimal', { precision: 18, scale: 2, comment: 'Debit amount in the context of the specified ledger', transformer: numericTransformerNotNull })
  debit: number;

  @Column('decimal', { precision: 18, scale: 2, comment: 'Credit amount in the context of the specified ledger', transformer: numericTransformerNotNull })
  credit: number;
}