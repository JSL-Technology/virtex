
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { JournalEntryLine } from './journal-entry-line.entity';
import { JournalEntryAttachment } from './journal-entry-attachment.entity';
import { Journal } from './journal.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';

export enum JournalEntryStatus {
  DRAFT = 'Draft',
  PENDING_APPROVAL = 'Pending Approval',
  POSTED = 'Posted',
  MODIFIED = 'Modified',
  VOID = 'Void',
  REJECTED = 'Rejected',
}

export enum JournalEntryType {
  MANUAL = 'MANUAL',
  CLOSING_ENTRY = 'CLOSING_ENTRY',
  OPENING_BALANCE = 'OPENING_BALANCE',
  SYSTEM_GENERATED = 'SYSTEM_GENERATED',
  AUDIT_ADJUSTMENT = 'AUDIT_ADJUSTMENT',
}

@Entity({ name: 'journal_entries' })
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;
  
  @ManyToOne(() => Ledger, { nullable: false, eager: true })
  @JoinColumn({ name: 'ledger_id' })
  ledger: Ledger;

  @Column({ name: 'ledger_id' })
  ledgerId: string;

  @Column({ type: 'date' })
  date: Date;

  @Column()
  description: string;
  

  @Column({ length: 3, nullable: true, name: 'currency_code' })
  currencyCode?: string;

  @Column('decimal', { precision: 18, scale: 6, nullable: true, name: 'exchange_rate' })
  exchangeRate?: number;


  @Column({
    type: 'enum',
    enum: JournalEntryStatus,
    default: JournalEntryStatus.DRAFT,
  })
  status: JournalEntryStatus;

  @Column({
    type: 'enum',
    enum: JournalEntryType,
    default: JournalEntryType.MANUAL,
  })
  entryType: JournalEntryType;
  

  @Column({ name: 'affects_opening_balance', default: false })
  affectsOpeningBalance: boolean;

  @OneToMany(() => JournalEntryLine, (line) => line.journalEntry, {
    cascade: true,
    eager: true,
  })
  lines: JournalEntryLine[];

  @Column({ name: 'reverses_entry_id', type: 'uuid', nullable: true })
  reversesEntryId: string | null;

  @OneToOne(() => JournalEntry)
  @JoinColumn({ name: 'reverses_entry_id' })
  reversesEntry?: JournalEntry;

  @OneToOne(() => JournalEntry, (entry) => entry.reversesEntry)
  reversedByEntry?: JournalEntry;

  @Column({ name: 'modified_to_entry_id', type: 'uuid', nullable: true })
  modifiedToEntryId: string | null;

  @OneToOne(() => JournalEntry, { nullable: true })
  @JoinColumn({ name: 'modified_to_entry_id' })
  modifiedToEntry?: JournalEntry;
  
  @Column({ name: 'modified_from_entry_id', type: 'uuid', nullable: true })
  modifiedFromEntryId: string | null;

  @OneToOne(() => JournalEntry, { nullable: true })
  @JoinColumn({ name: 'modified_from_entry_id' })
  modifiedFromEntry?: JournalEntry;

  @Column({ name: 'modification_reason', type: 'text', nullable: true })
  modificationReason: string | null;

  @OneToMany(() => JournalEntryAttachment, (attachment) => attachment.journalEntry, { cascade: true })
  attachments: JournalEntryAttachment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ default: false, name: 'reverses_next_period' })
  reversesNextPeriod: boolean;

  @Column({ default: false, name: 'is_reversed' })
  isReversed: boolean;

  @ManyToOne(() => Journal, { nullable: false, eager: true })
  @JoinColumn({ name: 'journal_id' })
  journal: Journal;

  @Column({ name: 'journal_id' })
  journalId: string;
}