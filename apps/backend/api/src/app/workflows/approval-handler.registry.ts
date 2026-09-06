import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DocumentTypeForApproval } from './entities/approval-policy.entity';

export interface ApprovalOutcomeContext {
  /**
   * The transaction the approval is being recorded in.
   *
   * The handler MUST use it. The whole point of the registry is that the document reaches the
   * ledger in the same transaction that grants the approval: either both happen or neither does.
   */
  manager: EntityManager;
  documentId: string;
  organizationId: string;
  /** Who granted or refused it. Never null — an approval with no author is not a control. */
  actorUserId: string;
  /** Only on rejection. */
  reason?: string;
}

/**
 * What a module that owns an approvable document has to provide.
 *
 * Implemented by the module that owns the document, not by `workflows`: the workflow engine knows
 * that a decision was made, and nothing about what a vendor bill or a journal entry is.
 */
export interface ApprovalHandler {
  readonly documentType: DocumentTypeForApproval;
  /** Called inside the approving transaction once the final step is granted. */
  onApproved(context: ApprovalOutcomeContext): Promise<void>;
  /** Called inside the rejecting transaction. Optional: many documents simply stay unposted. */
  onRejected?(context: ApprovalOutcomeContext): Promise<void>;
}

/**
 * Where a document type says what happens when its approval is granted.
 *
 * ## What this replaces, and why it is not an event
 *
 * Posting an approved document used to be wired through `EventEmitter2`:
 * `JournalEntriesService` and `AccountsPayableService` both carried
 * `@OnEvent('approval.request.approved')`. **Nothing emitted that event.** `WorkflowsService.approve`
 * marked the request APPROVED, saved it, and returned. So in any tenant that configured an approval
 * policy, an approved journal entry stayed `PENDING_APPROVAL` forever and an approved supplier bill
 * stayed `PENDING_APPROVAL` forever: no ledger row, no error, no notification, and — because
 * `PeriodClosingService` refuses to close a period containing unposted entries — a tenant
 * progressively unable to close its books, with nothing to explain why. Every test stubbed
 * `startApprovalProcess` to return `null`, so the path was never exercised end to end.
 *
 * Restoring the missing emit would have rebuilt the same fragility in working form. An in-process
 * emitter is not a delivery guarantee: `@OnEvent` runs after the approving transaction commits, so
 * a process that dies in between leaves the request approved and the document unposted — the exact
 * failure, reached a different way. And a listener that throws reports to nobody.
 *
 * A handler is called **inside** the approving transaction. The approval and the posting commit
 * together or roll back together, and a posting that fails — a period closed since submission, an
 * account blocked in the meantime — fails the approval itself, visibly, to the person who pressed
 * the button.
 */
@Injectable()
export class ApprovalHandlerRegistry {
  private readonly logger = new Logger(ApprovalHandlerRegistry.name);
  private readonly handlers = new Map<DocumentTypeForApproval, ApprovalHandler>();

  /**
   * Called by each document module in `onModuleInit`.
   *
   * Registration rather than a multi-provider token because the modules that own documents already
   * depend on `WorkflowsModule` (they ask it whether approval is required), and inverting that for
   * dependency injection would add a second cycle to a graph that already has one.
   */
  register(handler: ApprovalHandler): void {
    if (this.handlers.has(handler.documentType)) {
      // Two handlers for one document type means one of them silently never runs.
      throw new Error(
        `Ya hay un manejador de aprobación registrado para ${handler.documentType}.`,
      );
    }
    this.handlers.set(handler.documentType, handler);
    this.logger.log(`Manejador de aprobación registrado para ${handler.documentType}.`);
  }

  get(documentType: DocumentTypeForApproval): ApprovalHandler | undefined {
    return this.handlers.get(documentType);
  }
}
