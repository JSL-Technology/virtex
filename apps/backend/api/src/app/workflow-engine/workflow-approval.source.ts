import { Injectable, OnModuleInit } from '@nestjs/common';
import { ApprovalSource, ApprovalViewer, PendingDecision } from '../contracts/approvals/approval-source.contract';
import { ApprovalSourceRegistry } from '../contracts/approvals/approval-source.registry';
import { PERMISSIONS } from '../shared/permissions';
import { WorkflowTasksService } from './workflow-tasks.service';
import { taskLink } from './workflow-notifier.service';

/**
 * Business Workflow approvals, offered in the one approvals centre beside purchasing and accounting.
 *
 * An approver should not have to know which engine raised a decision: an «Approval» node's task
 * appears in the centre with its subject and amount, and «approve»/«reject» there complete the task
 * exactly as the workflow inbox would — same locked transaction, same assignment check, same
 * comment rule for a rejection.
 */
@Injectable()
export class WorkflowEngineApprovalSource implements ApprovalSource, OnModuleInit {
  readonly sourceId = 'workflow_engine';
  readonly decidePermission = PERMISSIONS.WORKFLOW_TASK_ACT;

  constructor(
    private readonly registry: ApprovalSourceRegistry,
    private readonly tasks: WorkflowTasksService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async pendingFor(viewer: ApprovalViewer): Promise<PendingDecision[]> {
    const open = await this.tasks.openApprovals(viewer.organizationId);
    return open
      .filter((task) => {
        if (task.assigneeUserId) return task.assigneeUserId === viewer.userId;
        if (task.assigneeRoleId) return viewer.roleIds.includes(task.assigneeRoleId);
        return true;
      })
      .map((task) => {
        const amount = task.facts.find((fact) => fact.type === 'number' && /amount|total|monto|importe/i.test(fact.name));
        const currency = task.facts.find((fact) => /currency/i.test(fact.name));
        return {
          source: this.sourceId,
          id: task.id,
          documentTypeKey: 'approvals.document_type.workflow_task',
          number: task.subject?.label ?? task.name,
          party: task.definitionName,
          amount: amount ? Number(amount.value) : null,
          currencyCode: currency ? String(currency.value) : null,
          requestedAt: task.createdAt.toISOString(),
          route: taskLink(task.id),
          step: null,
          canDecide: true,
          blockedReasonKey: null,
        };
      });
  }

  async approve(id: string, viewer: ApprovalViewer, comment?: string): Promise<void> {
    const task = await this.tasks.get(id, viewer.organizationId);
    const outcome = task.outcomes.includes('approve') ? 'approve' : task.outcomes[0];
    await this.tasks.complete(id, viewer.organizationId, { outcome, comment }, { userId: viewer.userId, roleIds: viewer.roleIds });
  }

  async reject(id: string, viewer: ApprovalViewer, reason: string): Promise<void> {
    const task = await this.tasks.get(id, viewer.organizationId);
    const outcome = task.outcomes.includes('reject') ? 'reject' : task.outcomes[task.outcomes.length - 1];
    await this.tasks.complete(id, viewer.organizationId, { outcome, comment: reason }, { userId: viewer.userId, roleIds: viewer.roleIds });
  }
}
