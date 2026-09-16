import { EntityManager, QueryRunner } from 'typeorm';
import { JournalEntry } from './entities/journal-entry.entity';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';

/**
 * Identifies which subledger originated a journal entry.
 *
 * Defined here — in the posting contract — so operational modules (inventory,
 * accounts-payable, invoices, etc.) can import it from the port rather than
 * pulling it from an accounting entity they don't own.
 */
export enum ModuleSlug {
  GL = 'general-ledger',
  AP = 'accounts-payable',
  AR = 'accounts-receivable',
  INVENTORY = 'inventory',
}

/**
 * Context every posting carries.
 *
 * `actorUserId` is null only for entries the system generates on a schedule — depreciation,
 * recurring entries, automatic reversals — and those record the reason instead. It is not optional
 * for anything a person initiates: an entry with no author is not an auditable record.
 */
export interface PostingContext {
  actorUserId?: string | null;
  systemReason?: string;
  idempotencyKey?: string;
  module?: ModuleSlug;
  allowClosedPeriod?: boolean;
}

/**
 * The only surface operational modules may touch to write the ledger.
 *
 * ## Why this exists
 *
 * Inventory, payroll, accounts-payable and the other subledgers all need to post entries to the
 * general ledger. Before this port, they injected `JournalEntriesService` directly, which gave
 * them access to every method in that service — including read paths, search, approval flows and
 * attachment management — none of which a subledger should call.
 *
 * The port narrows the contract to the two posting methods that subledgers actually need.
 * `JournalEntriesModule` provides the concrete implementation by binding the token to
 * `JournalEntriesService`.
 *
 * ## How to use it
 *
 * In your module:
 * ```ts
 * imports: [JournalEntriesModule],   // already required for the token to resolve
 * ```
 * In your service constructor:
 * ```ts
 * constructor(private readonly posting: AccountingPostingPort) {}
 * ```
 */
export abstract class AccountingPostingPort {
  /**
   * Post one balanced entry within an existing database transaction.
   *
   * `createWithManager` is the preferred path for new subledger code. The EntityManager
   * participates in the outer transaction without wrapping it, so the subledger's own write and
   * the accounting entry are atomic at the database level.
   */
  abstract createWithManager(
    manager: EntityManager,
    createDto: CreateJournalEntryDto,
    organizationId: string,
    context?: PostingContext,
  ): Promise<JournalEntry>;

  /**
   * Post one balanced entry on a caller-supplied QueryRunner.
   *
   * Kept for compatibility with older subledger code that holds a runner rather than a manager.
   * Prefer `createWithManager` in new code.
   */
  abstract createWithQueryRunner(
    queryRunner: QueryRunner,
    createDto: CreateJournalEntryDto,
    organizationId: string,
    context?: PostingContext,
  ): Promise<JournalEntry>;

  /**
   * Reverse an existing entry on the caller's transaction.
   *
   * Used by subledger voids and by the year-end close. The reversal is a new entry; the original
   * is marked reversed. Both share the caller's transaction so neither survives without the other.
   */
  abstract createSystemReversal(
    journalEntryId: string,
    organizationId: string,
    options: { reversalDate: string; reason: string },
    manager: EntityManager,
    context?: PostingContext,
  ): Promise<JournalEntry>;
}
