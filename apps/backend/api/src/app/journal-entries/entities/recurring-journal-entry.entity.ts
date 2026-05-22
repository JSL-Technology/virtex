
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CreateJournalEntryLineDto } from '../dto/create-journal-entry.dto';

export enum Frequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  ANNUALLY = 'ANNUALLY',
}

@Entity({ name: 'recurring_journal_entries' })
export class RecurringJournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  organizationId: string;

  @Column()
  description: string;


  @Column({ type: 'uuid', name: 'journal_id' })
  journalId: string;

  @Column({ type: 'jsonb' })
  lines: CreateJournalEntryLineDto[];

  @Column({ type: 'enum', enum: Frequency })
  frequency: Frequency;

  @Column({ type: 'date' })
  startDate: Date;

  @Column({ type: 'date', nullable: true })
  endDate: Date | null;

  @Column({ type: 'date', nullable: true, name: 'last_run_date' })
  lastRunDate: Date | null;

  @Column({ default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}