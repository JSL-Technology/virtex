
import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

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

  /**
   * `uuid`, matching `organizations.id`, with a foreign key.
   *
   * Twenty tables held the tenant reference as `character varying` while the column it points at
   * is a uuid. A join between them was a type error PostgreSQL refused outright, and a row whose
   * organization had been deleted was perfectly storable.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'date', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'date', name: 'end_date' })
  endDate: Date;

  @Column({ type: 'enum', enum: FiscalYearStatus, default: FiscalYearStatus.OPEN })
  status: FiscalYearStatus;

  /**
   * The entry that moved this year's result to retained earnings.
   *
   * Null while the year is open, and null again after a reopen — the transfer is reversed, so the
   * pointer would name an entry that no longer describes the year's state. `null` rather than
   * `undefined` because clearing it is a real operation, and an optional property cannot express
   * "explicitly cleared" to TypeORM.
   */
  @Column({ name: 'closing_journal_entry_id', type: 'uuid', nullable: true })
  closingJournalEntryId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}