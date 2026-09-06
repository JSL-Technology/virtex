import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JournalEntry, JournalEntryStatus } from './entities/journal-entry.entity';
import { JournalEntriesService } from './journal-entries.service';
import { DocumentTypeForApproval } from '../workflows/entities/approval-policy.entity';
import {
  ApprovalHandler,
  ApprovalHandlerRegistry,
  ApprovalOutcomeContext,
} from '../workflows/approval-handler.registry';
import { NotFoundError } from '../i18n/localized.exception';
import { ModuleSlug } from '../accounting/entities/accounting-period.entity';

/**
 * Posting a journal entry once its approval is granted.
 *
 * ## What this replaces
 *
 * `JournalEntriesService` carried `@OnEvent('approval.request.approved')`. Nothing in the
 * repository emitted that event, so an approved entry stayed `PENDING_APPROVAL` forever: no ledger
 * row, no error, and — since `PeriodClosingService` refuses to close a period containing unposted
 * entries — a tenant that eventually could not close its books, with nothing anywhere to say why.
 *
 * The handler runs **inside** the transaction that grants the approval. If posting fails — the
 * period closed between submission and approval, an account was blocked in the meantime, the
 * budget line is now exhausted — the approval fails with it, and the person who pressed the button
 * sees the reason. The previous design could not do that even in principle: a listener that runs
 * after the commit has nothing left to roll back and nobody left to tell.
 */
@Injectable()
export class JournalEntryApprovalHandler implements ApprovalHandler, OnModuleInit {
  readonly documentType = DocumentTypeForApproval.JOURNAL_ENTRY;
  private readonly logger = new Logger(JournalEntryApprovalHandler.name);

  constructor(
    private readonly entries: JournalEntriesService,
    private readonly registry: ApprovalHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApproved(context: ApprovalOutcomeContext): Promise<void> {
    const { manager, documentId, organizationId, actorUserId } = context;

    const entry = await manager.findOne(JournalEntry, {
      where: { id: documentId, organizationId },
    });
    if (!entry) {
      throw new NotFoundError('JOURNAL_ENTRIES.ASIENTO_NO_ENCONTRADO');
    }
    if (entry.status !== JournalEntryStatus.PENDING_APPROVAL) {
      // Already resolved — a retry of the same decision, or a second approval racing the first.
      // Not an error: the outcome the caller wants is already true.
      this.logger.warn(
        `Asiento ${documentId} en estado ${entry.status}; no requiere contabilización.`,
      );
      return;
    }

    await this.entries.postApproved(manager, entry, organizationId, actorUserId);
  }

  /**
   * A refused entry stays in the book as a rejected draft rather than disappearing.
   *
   * It has no number and no lines in any balance, and the rejection's reason and author are on the
   * approval request. Deleting it would erase the fact that somebody proposed it.
   */
  async onRejected(context: ApprovalOutcomeContext): Promise<void> {
    const { manager, documentId, organizationId, reason } = context;
    await manager.update(
      JournalEntry,
      { id: documentId, organizationId, status: JournalEntryStatus.PENDING_APPROVAL },
      {
        status: JournalEntryStatus.REJECTED,
        modificationReason: reason ?? null,
      },
    );
  }

  /** The subledger this document's period lock belongs to. */
  static readonly module = ModuleSlug.GL;
}
