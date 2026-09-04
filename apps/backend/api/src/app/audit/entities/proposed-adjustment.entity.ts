
import { FiscalYear } from '../../accounting/entities/fiscal-year.entity';
import { Journal } from '../../journal-entries/entities/journal.entity';
import { User } from '../../users/entities/user.entity/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ProposedAdjustmentEvidence } from './proposed-adjustment-evidence.entity';

export enum AdjustmentStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  POSTED = 'POSTED',
  FAILED = 'FAILED',
}

export class ProposedAdjustmentLine {
  @Column({ type: 'uuid' })
  accountId: string;

  @Column('decimal', { precision: 18, scale: 2 })
  debit: number;

  @Column('decimal', { precision: 18, scale: 2 })
  credit: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  dimensions?: Record<string, string>;
}

@Entity({ name: 'proposed_audit_adjustments' })
export class ProposedAdjustment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'fiscal_year_id' })
  fiscalYearId: string;

  @ManyToOne(() => FiscalYear)
  @JoinColumn({ name: 'fiscal_year_id' })
  fiscalYear: FiscalYear;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'text' })
  description: string;

  /**
   * Named, because it was not.
   *
   * Without `name` TypeORM created a second column, `journalId`, beside the `journal_id` the
   * `@JoinColumn` below declares. Writes went to `journalId`; the foreign key sat on `journal_id`,
   * which was therefore always null. A proposed adjustment could name a journal that no longer
   * existed, and `relations: ['journal']` came back null every time.
   */
  @Column({ name: 'journal_id', type: 'uuid' })
  journalId: string;

  @ManyToOne(() => Journal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_id' })
  journal: Journal;

  @Column({ type: 'jsonb' })
  lines: ProposedAdjustmentLine[];

  @Column({ type: 'enum', enum: AdjustmentStatus, default: AdjustmentStatus.PENDING_APPROVAL })
  status: AdjustmentStatus;

  /** Null once the proposer's account is deleted; the proposal is a record and stays. */
  @Column({ name: 'proposer_id', type: 'uuid', nullable: true })
  proposerId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'proposer_id' })
  proposer: User | null;

  @Column({ name: 'approval_request_id', type: 'uuid', nullable: true })
  approvalRequestId?: string;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId?: string;

  @OneToMany(() => ProposedAdjustmentEvidence, (evidence) => evidence.proposedAdjustment, {
    cascade: true,
  })
  evidence: ProposedAdjustmentEvidence[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}