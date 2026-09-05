import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { numericTransformer, numericTransformerNotNull } from '../../common/database/numeric.transformer';

export enum IntercompanyTransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * A movement between two companies of the same group.
 *
 * ## What this record has to survive
 *
 * The two halves are posted in different tenants, and only one of them can be inside the request's
 * transaction. The source entry commits with this row; the destination entry is posted by a worker
 * afterwards. That gap is real and cannot be closed by wishing — so the row is the record of it,
 * and `status` is what a report can look for. The previous version enqueued a job on a queue that
 * had no processor and was not even registered, so the destination entry was **never** created:
 * every intercompany transaction left the group permanently out of balance, at PENDING, with one
 * log line.
 *
 * `amount` is in `currencyCode`, the source company's document currency. `destinationAmount` is
 * what the receiving company books in its own base currency; it is stored rather than recomputed
 * because the rate that applied on the transaction date is the rate both halves must use, and
 * looking it up again later can find a different one.
 */
@Entity({ name: 'intercompany_transactions' })
@Index('IDX_intercompany_from_org_status', ['fromOrganizationId', 'status'])
@Index('IDX_intercompany_to_org_status', ['toOrganizationId', 'status'])
export class IntercompanyTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * `uuid` with a foreign key, not `character varying`.
   *
   * Both columns were plain strings, so a join against `organizations.id` was a type error
   * PostgreSQL refuses, and a transaction referencing a deleted tenant was perfectly storable.
   */
  @Column({ name: 'from_organization_id', type: 'uuid' })
  fromOrganizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'from_organization_id',
    foreignKeyConstraintName: 'FK_intercompany_from_org',
  })
  fromOrganization: Organization;

  @Column({ name: 'to_organization_id', type: 'uuid' })
  toOrganizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'to_organization_id',
    foreignKeyConstraintName: 'FK_intercompany_to_org',
  })
  toOrganization: Organization;

  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  amount: number;

  /** Legacy column, kept in step with `currencyCode` so old rows still read. */
  @Column()
  currency: string;

  @Column({ name: 'currency_code', type: 'varchar', length: 3, nullable: true })
  currencyCode: string | null;

  /** Source currency → destination base currency, on the transaction date. */
  @Column('decimal', {
    name: 'exchange_rate',
    precision: 18,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  exchangeRate: number | null;

  /** What the receiving company books, in its own base currency. */
  @Column('decimal', {
    name: 'destination_amount',
    precision: 18,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  destinationAmount: number | null;

  @Column()
  description: string;

  @CreateDateColumn({ name: 'transaction_date' })
  transactionDate: Date;

  @Column({ name: 'from_account_id', type: 'uuid', nullable: true })
  fromAccountId: string | null;

  @Column({ name: 'to_account_id', type: 'uuid', nullable: true })
  toAccountId: string | null;

  @Column({ name: 'source_journal_entry_id', type: 'uuid', nullable: true })
  sourceJournalEntryId: string | null;

  @Column({ name: 'destination_journal_entry_id', type: 'uuid', nullable: true })
  destinationJournalEntryId: string | null;

  @Column({
    type: 'enum',
    enum: IntercompanyTransactionStatus,
    default: IntercompanyTransactionStatus.PENDING,
  })
  status: IntercompanyTransactionStatus;

  /** Why the destination half could not be posted, when it could not. */
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
