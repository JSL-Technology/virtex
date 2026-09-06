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
import { CreateJournalEntryDto } from '../dto/create-journal-entry.dto';

export enum ImportBatchStatus {
  /** Previewed, not yet confirmed. */
  PENDING = 'PENDING',
  /** Its entries have been posted. */
  CONFIRMED = 'CONFIRMED',
  /** The confirm attempt failed; the batch is spent either way. */
  FAILED = 'FAILED',
}

/**
 * A previewed import, held between `POST import/preview` and `POST import/confirm`.
 *
 * ## Why this is a table and not a `Map`
 *
 * It was `const importBatchCache = new Map<string, ImportBatch>()` at module scope. Four
 * consequences, and the first is fatal to any real deployment:
 *
 * 1. **More than one instance breaks it outright.** The preview lands on one pod and the confirm
 *    on another, which has never heard of the batch and answers "expired or already processed".
 *    The product is sold as a hosted service; one instance is not a configuration anyone runs.
 * 2. **A restart loses every pending batch**, including one a user is looking at.
 * 3. **Nothing was evicted on confirm**, and the sweep only ran when someone previewed *another*
 *    file, so the parsed entries of every import ever performed stayed in the heap.
 * 4. **The rows crossed no tenant boundary check on write.** The confirm path did check
 *    `batch.organizationId`, but the batch itself lived outside the database's own scoping.
 *
 * The entries are stored as validated `CreateJournalEntryDto` objects — the same shape the posting
 * service takes — so confirming is exactly the operation previewing described.
 */
@Entity({ name: 'journal_entry_import_batches' })
@Index('IDX_journal_entry_import_batches_org', ['organizationId'])
@Index('IDX_journal_entry_import_batches_expiry', ['expiresAt'])
export class JournalEntryImportBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organization_id',
    foreignKeyConstraintName: 'FK_journal_entry_import_batches_organization',
  })
  organization: Organization;

  /**
   * Who previewed it.
   *
   * Not a foreign key to `users`: the batch is disposable and a user's deletion must not be able
   * to fail on it. Recorded so a confirm can be refused to anyone else — a batch is a draft of
   * someone's work, not a shared resource.
   */
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @Column({ type: 'varchar', length: 16, default: ImportBatchStatus.PENDING })
  status: ImportBatchStatus;

  /** The entries the preview judged valid, ready to post unchanged. */
  @Column({ type: 'jsonb' })
  entries: CreateJournalEntryDto[];

  /** After this instant the batch is refused, whether or not the sweeper has removed it yet. */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
