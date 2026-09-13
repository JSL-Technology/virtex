import { Injectable, OnModuleInit } from '@nestjs/common';
import { DocumentTypeForApproval } from '../../workflows/entities/approval-policy.entity';
import {
  ApprovalHandler,
  ApprovalHandlerRegistry,
  ApprovalOutcomeContext,
} from '../../workflows/approval-handler.registry';
import { AuditAdjustmentsService } from './audit-adjustments.service';
import { ModuleSlug } from '../../accounting/entities/accounting-period.entity';

/**
 * Posting an audit adjustment once its approval is granted.
 *
 * ## Why a tenant with a policy could not approve one
 *
 * `WorkflowsService` refuses an approval whose document type has no registered handler — better to
 * refuse than to grant one that will never take effect. `AUDIT_ADJUSTMENT` has been a
 * `DocumentTypeForApproval` since the baseline migration and no handler ever registered for it, so
 * a tenant that defined an approval policy for audit adjustments — which is the entire point of
 * having them reviewed — got `WORKFLOWS.SIN_MANEJADOR_PARA_TIPO_DOCUMENTO` when somebody tried to
 * approve. The only path that worked was the one where nobody approves anything.
 *
 * It posts INSIDE the approving transaction, like `JournalEntryApprovalHandler`: if the fiscal
 * year was archived between the proposal and the decision, or an account retired in the meantime,
 * the approval fails with the posting and the approver reads the reason. A post-commit listener
 * has nothing left to roll back and nobody left to tell.
 */
@Injectable()
export class AuditAdjustmentApprovalHandler implements ApprovalHandler, OnModuleInit {
  readonly documentType = DocumentTypeForApproval.AUDIT_ADJUSTMENT;

  constructor(
    private readonly adjustments: AuditAdjustmentsService,
    private readonly registry: ApprovalHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApproved(context: ApprovalOutcomeContext): Promise<void> {
    const { manager, documentId, organizationId } = context;
    await this.adjustments.postApproved(manager, documentId, organizationId);
  }

  async onRejected(context: ApprovalOutcomeContext): Promise<void> {
    const { manager, documentId, organizationId } = context;
    await this.adjustments.markRejected(manager, documentId, organizationId);
  }

  /** The subledger this document's period lock belongs to. */
  static readonly module = ModuleSlug.GL;
}
