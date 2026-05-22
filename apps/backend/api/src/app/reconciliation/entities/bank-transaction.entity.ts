import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BankStatement } from './bank-statement.entity';
import { JournalEntryLine } from '../../journal-entries/entities/journal-entry-line.entity';

export enum TransactionStatus {
  UNRECONCILED = 'unreconciled',
  MATCHED = 'matched',
  MANUALLY_MATCHED = 'manually_matched',
}

@Entity({ name: 'bank_transactions' })
export class BankTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'statement_id' })
  statementId: string;

  @ManyToOne(() => BankStatement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'statement_id' })
  statement: BankStatement;

  @Column({ type: 'date' })
  date: Date;

  @Column()
  description: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  debit: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  credit: number;

  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.UNRECONCILED })
  status: TransactionStatus;

  @Column({ name: 'matched_entry_line_id', type: 'uuid', nullable: true })
  matchedEntryLineId: string | null;

  @ManyToOne(() => JournalEntryLine, { nullable: true })
  @JoinColumn({ name: 'matched_entry_line_id' })
  matchedEntryLine: JournalEntryLine;
}
