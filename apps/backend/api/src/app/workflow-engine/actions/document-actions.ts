import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApprovalSourceRegistry } from '../../contracts/approvals/approval-source.registry';
import { isLocalizedError } from '../../i18n/localized.exception';
import {
  WorkflowAction,
  WorkflowActionContext,
  WorkflowActionRegistry,
  WorkflowActionResult,
} from '../workflow-action.registry';
import { WorkflowDirectoryService, interpolate } from '../workflow-directory.service';

/**
 * Which approval source decides a document, by the instance subject's type.
 *
 * The subject is what an event-started process is about (`purchase_order` for «Orden de compra
 * creada»). Each entry names the source that owns that document's approval lifecycle in the
 * shared `ApprovalSourceRegistry`, so the engine reaches purchasing or the classic approval
 * engine without importing either.
 */
export const DOCUMENT_DECISION_SOURCES: Readonly<Record<string, string>> = {
  purchase_order: 'purchase_order',
  purchase_requisition: 'purchase_requisition',
  approval_request: 'workflow',
};

export const DOCUMENT_DECISION_ACTION = 'document_decision';

/**
 * The step that closes the loop between a process and the document it is about.
 *
 * Without it a process could «approve» a purchase order in its own timeline while the order itself
 * stayed in draft, waiting for someone to approve it a second time somewhere else — the process was
 * a diagram beside the ERP rather than its control. This action applies the decision on the
 * document through the same service the approvals centre uses, with every rule that service
 * enforces (segregation of duties included), on behalf of the person who decided the last task.
 *
 * It never throws: a refused decision (the approver created the order, the order moved on) is the
 * `error` outcome with its reason in the timeline, for the author to route.
 */
@Injectable()
export class DocumentWorkflowActions implements OnModuleInit {
  private readonly logger = new Logger(DocumentWorkflowActions.name);

  constructor(
    private readonly registry: WorkflowActionRegistry,
    private readonly approvals: ApprovalSourceRegistry,
    private readonly directory: WorkflowDirectoryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.decide());
  }

  private decide(): WorkflowAction {
    return {
      key: DOCUMENT_DECISION_ACTION,
      labelKey: 'workflow_engine.action.document_decision',
      descriptionKey: 'workflow_engine.action_help.document_decision',
      outcomes: ['ok', 'error'],
      params: [
        {
          name: 'decision',
          labelKey: 'workflow_engine.param.decision',
          type: 'select',
          required: true,
          options: ['approve', 'reject'],
          optionLabelKeys: {
            approve: 'workflow_engine.param.decision_approve',
            reject: 'workflow_engine.param.decision_reject',
          },
          defaultValue: 'approve',
        },
        {
          name: 'reason',
          labelKey: 'workflow_engine.param.reason',
          type: 'text',
          templated: true,
          maxLength: 1000,
          defaultValue: '{{lastComment}}',
          hintKey: 'workflow_engine.param.reason_hint',
        },
      ],
      writes: () => ['document'],
      run: (ctx) => this.run(ctx),
    };
  }

  private async run(ctx: WorkflowActionContext): Promise<WorkflowActionResult> {
    const decision = String(ctx.params['decision'] ?? 'approve') === 'reject' ? 'reject' : 'approve';
    const fail = (key: string, params: Record<string, string | number> = {}): WorkflowActionResult => ({
      outcome: 'error',
      patch: { document: { ok: false, decision, reason: key } },
      summary: key,
      summaryKey: key,
      summaryParams: params,
    });

    const subject = ctx.subject;
    if (!subject?.type || !subject.id) return fail('workflow_engine.document_result.no_document');
    const source = this.approvals.get(DOCUMENT_DECISION_SOURCES[subject.type] ?? '');
    if (!source) return fail('workflow_engine.document_result.unsupported', { type: subject.type });

    const actorId = typeof ctx.context['lastActorUserId'] === 'string' ? (ctx.context['lastActorUserId'] as string) : ctx.startedByUserId;
    if (!actorId) return fail('workflow_engine.document_result.no_actor');
    const actor = await this.directory.principal(ctx.organizationId, actorId);
    if (!actor) return fail('workflow_engine.document_result.no_actor');

    const reason = interpolate(String(ctx.params['reason'] ?? ''), ctx.context).trim().slice(0, 1000);
    const viewer = { userId: actor.id, organizationId: ctx.organizationId, permissions: actor.permissions, roleIds: actor.roleIds };
    try {
      if (decision === 'approve') await source.approve(subject.id, viewer, reason || undefined);
      else await source.reject(subject.id, viewer, reason || 'workflow');
    } catch (error) {
      const key = isLocalizedError(error) ? error.messageKey : 'workflow_engine.document_result.failed';
      this.logger.warn(`[wf ${ctx.instanceId}] ${decision} ${subject.type}/${subject.id} refused: ${(error as Error)?.message ?? error}`);
      return fail(key, { document: subject.label ?? subject.id });
    }
    return {
      outcome: 'ok',
      patch: { document: { ok: true, decision, by: actor.id, at: new Date().toISOString() } },
      summary: `${decision} ${subject.label ?? subject.id}`,
      summaryKey: decision === 'approve' ? 'workflow_engine.document_result.approved' : 'workflow_engine.document_result.rejected',
      summaryParams: { document: subject.label ?? subject.id, name: actor.name },
    };
  }
}
