
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

  /**
   * `YYYY-MM-DD`, and typed as such.
   *
   * These three were declared `Date` and are `string` at run time — a `date` column has no time and
   * the driver returns it verbatim. The schedule then did `new Date(entry.startDate)` followed by
   * `setHours(0,0,0,0)`, which parses as UTC midnight and re-anchors to *local* midnight: on a
   * server west of Greenwich a template starting the 15th evaluated as the 14th, so a monthly entry
   * posted a day early every month, and an annual one could be skipped entirely.
   */
  @Column({ type: 'date', name: 'startDate' })
  startDate: string;

  @Column({ type: 'date', nullable: true, name: 'endDate' })
  endDate: string | null;

  @Column({ type: 'date', nullable: true, name: 'last_run_date' })
  lastRunDate: string | null;

  @Column({ default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}