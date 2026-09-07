import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApprovalPolicy, DocumentTypeForApproval } from './entities/approval-policy.entity';
import { ApprovalPolicyStep } from './entities/approval-policy-step.entity';
import { ApprovalRequest, ApprovalStatus } from './entities/approval-request.entity';
import {
  ApprovalDecision,
  ApprovalStepAction,
} from './entities/approval-step-action.entity';
import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { CreateApprovalPolicyDto, UpdateApprovalPolicyDto } from './dto/approval-policy.dto';
import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
} from '../i18n/localized.exception';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { toMinorUnits } from '../common/money';

/** Who is acting, and under what authority. */
export interface ApprovalActor {
  userId: string;
  organizationId: string;
  /** Role ids the user holds, from the authenticated principal — never from the request body. */
  roleIds: string[];
}

/**
 * Approval policies, and the decisions taken under them.
 *
 * ## What was broken, and why each part mattered
 *
 * **The approval did nothing.** `approve` marked the request APPROVED and returned. The two
 * listeners meant to post the document — in `JournalEntriesService` and `AccountsPayableService` —
 * were bound to `approval.request.approved`, an event no code in the repository emitted. So any
 * tenant with a policy accumulated approved-but-unposted documents indefinitely and could no longer
 * close a period, with no error anywhere to say why. See `ApprovalHandlerRegistry` for why the fix
 * is a handler called inside the transaction rather than the missing emit.
 *
 * **Anyone could decide anything.** `approve` and `reject` looked the request up by id alone, with
 * no `organizationId`, and the controller put no permission on either route. `reject` additionally
 * checked no role and recorded no actor. Any authenticated user of any tenant could therefore
 * reject any approval request in the system by guessing or enumerating a uuid — blocking another
 * customer's invoices and journal entries, leaving no trace of who did it.
 *
 * **There was no segregation of duties.** The request did not record who raised it, so nothing
 * could compare submitter with approver: a user holding the step's role composed a journal entry
 * and approved their own entry. That is the one control the feature exists to provide.
 *
 * **The chain was not a record.** `approvedByUserId` was written only on the final step, so in a
 * multi-step policy the intermediate approvers left no trace of any kind.
 *
 * **Step selection was arbitrary.** `policy.steps.find(step => amount >= step.minAmount)` returned
 * the first step in relation order whose threshold was met, so a policy whose steps were stored out
 * of order skipped escalation levels silently.
 */
@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    @InjectRepository(ApprovalPolicy)
    private readonly policyRepository: Repository<ApprovalPolicy>,
    @InjectRepository(ApprovalRequest)
    private readonly requestRepository: Repository<ApprovalRequest>,
    private readonly handlers: ApprovalHandlerRegistry,
    private readonly auditTrail: AuditTrailService,
    private readonly dataSource: DataSource,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Policies
  // ───────────────────────────────────────────────────────────────────────────

  async createPolicy(
    dto: CreateApprovalPolicyDto,
    organizationId: string,
  ): Promise<ApprovalPolicy> {
    this.assertStepsAreCoherent(dto.steps);
    const policy = this.policyRepository.create({ ...dto, organizationId });
    return this.policyRepository.save(policy);
  }

  async getPolicies(organizationId: string): Promise<ApprovalPolicy[]> {
    return this.policyRepository.find({
      where: { organizationId },
      relations: ['steps'],
      order: { steps: { order: 'ASC' } },
    });
  }

  async updatePolicy(
    policyId: string,
    dto: UpdateApprovalPolicyDto,
    organizationId: string,
  ): Promise<ApprovalPolicy> {
    if (dto.steps) this.assertStepsAreCoherent(dto.steps);
    const policy = await this.policyRepository.findOne({
      where: { id: policyId, organizationId },
      relations: ['steps'],
    });
    if (!policy) throw new NotFoundError('WORKFLOWS.POLITICA_APROBACION_NO_ENCONTRADA');

    const updated = this.policyRepository.merge(policy, dto);
    return this.policyRepository.save(updated);
  }

  async deletePolicy(policyId: string, organizationId: string): Promise<void> {
    const pending = await this.requestRepository.count({
      where: { organizationId, policyId, status: ApprovalStatus.PENDING },
    });
    if (pending > 0) {
      // Deleting the policy would strand them: `approve` cannot find the step to check the role
      // against, so every one of them becomes undecidable and its document unpostable.
      throw new BadRequestError('WORKFLOWS.POLITICA_TIENE_SOLICITUDES_PENDIENTES', { pending });
    }
    const result = await this.policyRepository.delete({ id: policyId, organizationId });
    if (result.affected === 0) {
      throw new NotFoundError('WORKFLOWS.POLITICA_APROBACION_NO_ENCONTRADA');
    }
  }

  /** Two steps with the same order make the chain's traversal depend on row order. */
  private assertStepsAreCoherent(steps: { order: number; minAmount: number }[]): void {
    if (!steps || steps.length === 0) return;
    const orders = new Set(steps.map((step) => step.order));
    if (orders.size !== steps.length) {
      throw new BadRequestError('WORKFLOWS.PASOS_CON_ORDEN_DUPLICADO');
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Raising a request
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Decide whether `documentId` needs approval, and open the request if it does.
   *
   * Runs on the caller's `EntityManager`: the request has to be written in the same transaction as
   * the document it refers to, or a rolled-back document leaves an approval request pointing at
   * nothing.
   *
   * Returns `null` when no policy applies — the caller then posts directly, which is the path every
   * tenant without a configured policy takes.
   */
  async startApprovalProcess(
    organizationId: string,
    documentId: string,
    documentType: DocumentTypeForApproval,
    amount: number,
    requestedByUserId: string | null = null,
    manager?: EntityManager,
  ): Promise<ApprovalRequest | null> {
    const em = manager ?? this.dataSource.manager;

    const policy = await em.findOne(ApprovalPolicy, {
      where: { organizationId, documentType },
      relations: ['steps'],
    });
    if (!policy || policy.steps.length === 0) return null;

    const chain = this.applicableSteps(policy.steps, amount);
    if (chain.length === 0) return null;

    const request = em.create(ApprovalRequest, {
      organizationId,
      documentId,
      documentType,
      policyId: policy.id,
      status: ApprovalStatus.PENDING,
      currentStep: chain[0].order,
      requestedByUserId,
      amount,
    });
    const saved = await em.save(request);

    await this.auditTrail.recordWithManager(em, {
      userId: requestedByUserId,
      organizationId,
      entity: 'approval_requests',
      entityId: saved.id,
      actionType: ActionType.CREATE,
      newValue: {
        event: 'approval-requested',
        documentType,
        documentId,
        amount,
        steps: chain.map((step) => step.order),
      },
    });

    return saved;
  }

  /**
   * The steps that apply to an amount, in order.
   *
   * Sorted by `order` first, so the chain is the chain the tenant configured rather than whatever
   * order the rows came back in; then filtered by threshold, so "over 10 000 also needs the CFO"
   * means what it says. The previous implementation took the FIRST step whose threshold was met in
   * relation order and then walked to the next `order` regardless of threshold, which both skipped
   * levels and applied levels that did not apply.
   */
  private applicableSteps(steps: ApprovalPolicyStep[], amount: number): ApprovalPolicyStep[] {
    const cents = toMinorUnits(amount, 'USD');
    return [...steps]
      .sort((a, b) => a.order - b.order)
      .filter((step) => cents >= toMinorUnits(Number(step.minAmount), 'USD'));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Deciding
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Grant one step. On the final step, post the document in the same transaction.
   */
  async approve(requestId: string, actor: ApprovalActor, comment?: string): Promise<ApprovalRequest> {
    return this.dataSource.transaction(async (manager) => {
      const { request, policy, step } = await this.loadDecidable(manager, requestId, actor);

      // Segregation of duties. Configurable later if a tenant genuinely wants it off; closed by
      // default, because an approval a submitter can grant themselves is not a control.
      if (request.requestedByUserId && request.requestedByUserId === actor.userId) {
        throw new ForbiddenError('WORKFLOWS.NO_PUEDE_APROBAR_SU_PROPIA_SOLICITUD');
      }

      await manager.save(
        manager.create(ApprovalStepAction, {
          requestId: request.id,
          organizationId: request.organizationId,
          stepOrder: step.order,
          roleId: step.roleId,
          actorUserId: actor.userId,
          decision: ApprovalDecision.APPROVED,
          comment: comment ?? null,
        }),
      );

      const chain = this.applicableSteps(policy.steps, Number(request.amount));
      const next = chain.find((candidate) => candidate.order > request.currentStep);

      if (next) {
        request.currentStep = next.order;
        const escalated = await manager.save(request);
        await this.recordDecision(manager, escalated, actor, 'approval-step-granted', {
          step: step.order,
          nextStep: next.order,
        });
        return escalated;
      }

      request.status = ApprovalStatus.APPROVED;
      request.approvedByUserId = actor.userId;
      request.approvedAt = new Date();
      const approved = await manager.save(request);

      // Inside the transaction. See `ApprovalHandlerRegistry`: an approval whose document did not
      // post is the failure this whole rebuild exists to remove, and a post-commit listener
      // reintroduces it.
      const handler = this.handlers.get(approved.typedDocumentType);
      if (!handler) {
        // Better to refuse the approval than to grant one that will never take effect.
        throw new InternalServerError('WORKFLOWS.SIN_MANEJADOR_PARA_TIPO_DOCUMENTO', {
          documentType: approved.documentType,
        });
      }
      await handler.onApproved({
        manager,
        documentId: approved.documentId,
        organizationId: approved.organizationId,
        actorUserId: actor.userId,
      });

      await this.recordDecision(manager, approved, actor, 'approval-granted', {
        step: step.order,
      });
      this.logger.log(
        `Solicitud ${approved.id} (${approved.documentType}) aprobada por ${actor.userId}.`,
      );
      return approved;
    });
  }

  /** Refuse the request. The document is told, in the same transaction. */
  async reject(requestId: string, actor: ApprovalActor, reason: string): Promise<ApprovalRequest> {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new BadRequestError('WORKFLOWS.RAZON_RECHAZO_OBLIGATORIA');

    return this.dataSource.transaction(async (manager) => {
      const { request, step } = await this.loadDecidable(manager, requestId, actor);

      await manager.save(
        manager.create(ApprovalStepAction, {
          requestId: request.id,
          organizationId: request.organizationId,
          stepOrder: step.order,
          roleId: step.roleId,
          actorUserId: actor.userId,
          decision: ApprovalDecision.REJECTED,
          comment: trimmed,
        }),
      );

      request.status = ApprovalStatus.REJECTED;
      request.rejectionReason = trimmed;
      request.rejectedByUserId = actor.userId;
      request.rejectedAt = new Date();
      const rejected = await manager.save(request);

      const handler = this.handlers.get(rejected.typedDocumentType);
      await handler?.onRejected?.({
        manager,
        documentId: rejected.documentId,
        organizationId: rejected.organizationId,
        actorUserId: actor.userId,
        reason: trimmed,
      });

      await this.recordDecision(manager, rejected, actor, 'approval-rejected', {
        step: step.order,
        reason: trimmed,
      });
      return rejected;
    });
  }

  /** Requests this tenant has open, for the approval inbox. */
  async pendingFor(organizationId: string): Promise<ApprovalRequest[]> {
    return this.requestRepository.find({
      where: { organizationId, status: ApprovalStatus.PENDING },
      order: { id: 'ASC' },
    });
  }

  /** The decisions taken on one request, oldest first. */
  async historyFor(requestId: string, organizationId: string): Promise<ApprovalStepAction[]> {
    const request = await this.requestRepository.findOne({
      where: { id: requestId, organizationId },
    });
    if (!request) throw new NotFoundError('WORKFLOWS.SOLICITUD_APROBACION_NO_ENCONTRADA');
    return this.dataSource.manager.find(ApprovalStepAction, {
      where: { requestId, organizationId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Load a request the actor is actually entitled to decide, or refuse.
   *
   * Scoped to the actor's tenant — the whole reason a user of one organization could reject another
   * organization's documents was that this lookup used to be `findOneBy({ id })`.
   */
  private async loadDecidable(
    manager: EntityManager,
    requestId: string,
    actor: ApprovalActor,
  ): Promise<{ request: ApprovalRequest; policy: ApprovalPolicy; step: ApprovalPolicyStep }> {
    const request = await manager.findOne(ApprovalRequest, {
      where: { id: requestId, organizationId: actor.organizationId },
    });
    if (!request) throw new NotFoundError('WORKFLOWS.SOLICITUD_APROBACION_NO_ENCONTRADA');
    if (request.status !== ApprovalStatus.PENDING) {
      throw new BadRequestError('WORKFLOWS.SOLICITUD_YA_HA_SIDO_PROCESADA');
    }

    const policy = await manager.findOne(ApprovalPolicy, {
      where: { id: request.policyId, organizationId: actor.organizationId },
      relations: ['steps'],
    });
    if (!policy) {
      throw new InternalServerError('WORKFLOWS.NO_ENCONTRO_POLITICA_APROBACION_ID_ASOCIADA_ESTA', {
        policyId: request.policyId,
      });
    }

    const step = policy.steps.find((candidate) => candidate.order === request.currentStep);
    if (!step) {
      throw new InternalServerError('WORKFLOWS.PASO_ACTUAL_NO_EXISTE_EN_LA_POLITICA', {
        step: request.currentStep,
      });
    }
    if (!actor.roleIds.includes(step.roleId)) {
      throw new ForbiddenError('WORKFLOWS.NO_TIENES_PERMISOS_APROBAR_ESTE_PASO');
    }

    return { request, policy, step };
  }

  private async recordDecision(
    manager: EntityManager,
    request: ApprovalRequest,
    actor: ApprovalActor,
    event: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.auditTrail.recordWithManager(manager, {
      userId: actor.userId,
      organizationId: request.organizationId,
      entity: 'approval_requests',
      entityId: request.id,
      actionType: ActionType.UPDATE,
      newValue: {
        event,
        status: request.status,
        documentType: request.documentType,
        documentId: request.documentId,
        ...detail,
      },
    });
  }
}
