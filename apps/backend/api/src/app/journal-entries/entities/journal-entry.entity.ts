
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
  Index,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { JournalEntryLine } from './journal-entry-line.entity';
import { JournalEntryAttachment } from './journal-entry-attachment.entity';
import { Journal } from './journal.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { numericTransformer } from '../../common/database/numeric.transformer';

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
// Every balance in the product is a SUM over posted entries in a date range for one tenant.
// Without this the ledger had no index at all beyond its primary key.
@Index('IDX_journal_entries_org_status_date', ['organizationId', 'status', 'date'])
@Index('IDX_journal_entries_org_entry_number', ['organizationId', 'entryNumber'], {
  unique: true,
  where: '"entry_number" IS NOT NULL',
})
// Idempotency is only real if the database holds it: two workers can both read "not posted yet".
@Index('IDX_journal_entries_org_idempotency_key', ['organizationId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;
  
  @ManyToOne(() => Ledger, { nullable: false, eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ledger_id' })
  ledger: Ledger;

  @Column({ name: 'ledger_id' })
  ledgerId: string;

  @Column({ type: 'date' })
  date: Date;

  /**
   * The consecutive number this entry carries in its journal's series, e.g. `GEN-2026-000042`.
   *
   * An entry used to be identified to the reader as `JE-` plus eight characters of its UUID. A
   * libro diario has to be a consecutive series without gaps — it is the form the DGII, the SAT
   * (`NumUnIdenPol`), the DIAN and SUNAT all require — and a UUID is neither consecutive nor
   * ordered. Allocated by `JournalEntryNumberingService` inside the posting transaction.
   *
   * Nullable only so a draft, which has not been assigned a place in the series, can exist. Every
   * posted entry has one, and the unique index enforces it cannot be shared.
   */
  @Column({ name: 'entry_number', type: 'varchar', length: 40, nullable: true })
  entryNumber: string | null;

  @Column()
  description: string;

  /**
   * Who posted this entry, and when.
   *
   * Neither was recorded. The audit service was called exactly once in the whole accounting module
   * — for reopening a period — so there was no way to answer who booked, reversed or modified any
   * entry in the ledger. An accounting record without an author is not an accounting record.
   */
  @Column({ name: 'posted_by_user_id', type: 'uuid', nullable: true })
  postedByUserId: string | null;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;
  

  @Column({ length: 3, nullable: true, name: 'currency_code' })
  currencyCode?: string;

  @Column('decimal', { precision: 18, scale: 6, nullable: true, name: 'exchange_rate', transformer: numericTransformer })
  exchangeRate?: number;

  /**
   * Where the rate came from, so a foreign-currency posting can be substantiated rather than
   * trusted.
   *
   * The entry stored a bare number. A number is not evidence: in a region where the authority
   * publishes an obligatory rate — and where an official rate and a market rate can differ by a
   * factor — an auditor asked to verify a posting has to be able to see which quote was applied,
   * from what source, of what date, and whether it was read directly, inverted, or triangulated
   * through the dollar. `ExchangeRateResolver` computed all four and every caller threw them away.
   */
  @Column({ name: 'exchange_rate_type', type: 'varchar', length: 24, nullable: true })
  exchangeRateType: string | null;

  @Column({ name: 'exchange_rate_source', type: 'varchar', length: 64, nullable: true })
  exchangeRateSource: string | null;

  /** `IDENTITY`, `DIRECT`, `INVERSE` or `TRIANGULATED`. */
  @Column({ name: 'exchange_rate_method', type: 'varchar', length: 16, nullable: true })
  exchangeRateMethod: string | null;

  /** The day the underlying quote is from, which may be earlier than the entry's own date. */
  @Column({ name: 'exchange_rate_quoted_on', type: 'date', nullable: true })
  exchangeRateQuotedOn: string | null;

  /**
   * The business fact this entry records, for postings a system generates.
   *
   * Unique per tenant, so the same fact cannot be booked twice however many times its trigger
   * fires. A retried webhook, a redelivered queue job, a double-clicked button and a replayed
   * event all arrive with the key of something already in the book, and the unique index is what
   * makes the second one impossible rather than merely unlikely.
   *
   * Null for entries a person composed: those are not replays of anything.
   */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 200, nullable: true })
  idempotencyKey: string | null;


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

  @OneToOne(() => JournalEntry, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reverses_entry_id' })
  reversesEntry?: JournalEntry;

  @OneToOne(() => JournalEntry, (entry) => entry.reversesEntry)
  reversedByEntry?: JournalEntry;

  @Column({ name: 'modified_to_entry_id', type: 'uuid', nullable: true })
  modifiedToEntryId: string | null;

  @OneToOne(() => JournalEntry, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'modified_to_entry_id' })
  modifiedToEntry?: JournalEntry;
  
  @Column({ name: 'modified_from_entry_id', type: 'uuid', nullable: true })
  modifiedFromEntryId: string | null;

  @OneToOne(() => JournalEntry, { nullable: true, onDelete: 'SET NULL' })
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

  @ManyToOne(() => Journal, { nullable: false, eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_id' })
  journal: Journal;

  @Column({ name: 'journal_id' })
  journalId: string;
}