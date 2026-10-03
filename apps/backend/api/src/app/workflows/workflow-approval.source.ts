import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ApprovalSource,
  ApprovalViewer,
  PendingDecision,
} from '../contracts/approvals/approval-source.contract';
import { ApprovalSourceRegistry } from '../contracts/approvals/approval-source.registry';
import { PERMISSIONS } from '../shared/permissions';
import { ApprovalPolicyStep } from './entities/approval-policy-step.entity';
import { ApprovalRequest, ApprovalStatus } from './entities/approval-request.entity';
import { WorkflowsService } from './workflows.service';

/** Where each workflow document lives in the client, so it can be read before it is decided. */
const ROUTES: Record<string, (documentId: string) => string> = {
  VENDOR_BILL: (id) => `/accounts-payable/${id}`,
  JOURNAL_ENTRY: (id) => `/accounting/journal-entries/${id}`,
  PAYMENT_BATCH: () => '/accounts-payable/payments',
  PERIOD_REOPENING: () => '/accounting/periods',
  AUDIT_ADJUSTMENT: () => '/accounting/audit-adjustments',
};

/**
 * The generic approval engine as a source of pending decisions (QA A-11).
 *
 * `canDecide` mirrors `WorkflowsService.loadDecidable` and its segregation-of-duties rule, so the
 * inbox offers the buttons exactly where the decision would be accepted.
 */
@Injectable()
export class WorkflowApprovalSource implements ApprovalSource, OnModuleInit {
  readonly sourceId = 'workflow';
  readonly decidePermission = PERMISSIONS.WORKFLOWS_DECIDE;

  constructor(
    private readonly registry: ApprovalSourceRegistry,
    private readonly workflows: WorkflowsService,
    @InjectRepository(ApprovalRequest) private readonly requests: Repository<ApprovalRequest>,
    @InjectRepository(ApprovalPolicyStep) private readonly steps: Repository<ApprovalPolicyStep>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async pendingFor(viewer: ApprovalViewer): Promise<PendingDecision[]> {
    const pending = await this.requests.find({
      where: { organizationId: viewer.organizationId, status: ApprovalStatus.PENDING },
      order: { id: 'ASC' },
    });
    if (pending.length === 0) return [];

    const policyIds = [...new Set(pending.map((request) => request.policyId))];
    const steps = await this.steps.find({ where: { policyId: In(policyIds) } });
    const roleFor = new Map(steps.map((step) => [`${step.policyId}:${step.order}`, step.roleId]));

    return pending.map((request) => {
      const own = !!request.requestedByUserId && request.requestedByUserId === viewer.userId;
      const stepRole = roleFor.get(`${request.policyId}:${request.currentStep}`);
      const inRole = !!stepRole && viewer.roleIds.includes(stepRole);
      return {
        source: this.sourceId,
        id: request.id,
        documentTypeKey: `approvals.document_type.${request.documentType.toLowerCase()}`,
        number: request.documentId.slice(0, 8),
        party: null,
        amount: request.amount === null || request.amount === undefined ? null : Number(request.amount),
        currencyCode: null,
        requestedAt: null,
        route: ROUTES[request.documentType]?.(request.documentId) ?? null,
        step: request.currentStep,
        canDecide: !own && inRole,
        blockedReasonKey: own
          ? 'approvals.blocked.own_request'
          : inRole
            ? null
            : 'approvals.blocked.not_your_step',
      };
    });
  }

  async approve(id: string, viewer: ApprovalViewer, comment?: string): Promise<void> {
    await this.workflows.approve(id, this.actor(viewer), comment);
  }

  async reject(id: string, viewer: ApprovalViewer, reason: string): Promise<void> {
    await this.workflows.reject(id, this.actor(viewer), reason);
  }

  private actor(viewer: ApprovalViewer) {
    return { userId: viewer.userId, organizationId: viewer.organizationId, roleIds: [...viewer.roleIds] };
  }
}
