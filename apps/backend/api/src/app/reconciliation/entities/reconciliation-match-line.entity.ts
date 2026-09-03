import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { ReconciliationMatch } from './reconciliation-match.entity';
import { JournalEntryLine } from '../../journal-entries/entities/journal-entry-line.entity';

/**
 * One ledger line inside a match.
 *
 * The uniqueness constraint on `journal_entry_line_id` is the load-bearing part: a ledger line
 * belongs to at most one match, so the same payment cannot be cleared twice against two different
 * statement lines and quietly balance the proof.
 */
@Entity({ name: 'reconciliation_match_lines' })
@Unique('UQ_reconciliation_match_lines_line', ['journalEntryLineId'])
@Index('IDX_reconciliation_match_lines_match', ['matchId'])
export class ReconciliationMatchLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'match_id', type: 'uuid' })
  matchId: string;

  @ManyToOne('ReconciliationMatch', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'match_id' })
  match: ReconciliationMatch;

  @Column({ name: 'journal_entry_line_id', type: 'uuid' })
  journalEntryLineId: string;

  @ManyToOne(() => JournalEntryLine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_line_id' })
  journalEntryLine: JournalEntryLine;
}
