
import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum FiscalYearStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  LOCKED = 'LOCKED',
}

@Entity({ name: 'fiscal_years' })
@Index(['organizationId', 'startDate', 'endDate'], { unique: true })
export class FiscalYear {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ type: 'date', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', name: 'end_date' })
  endDate: Date;

  @Column({ type: 'enum', enum: FiscalYearStatus, default: FiscalYearStatus.OPEN })
  status: FiscalYearStatus;

  @Column({ name: 'closing_journal_entry_id', type: 'uuid', nullable: true })
  closingJournalEntryId?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}