import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  PurchaseRequisition,
  PurchaseRequisitionStatus,
} from './entities/purchase-requisition.entity';
import { PurchaseRequisitionLine } from './entities/purchase-requisition-line.entity';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';
import { UpdatePurchaseRequisitionDto } from './dto/update-purchase-requisition.dto';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../common/pagination';
import {
  JournalEntryNumberingService,
  SEQUENCE_SCOPE,
} from '../journal-entries/journal-entry-numbering.service';
import { roundAmount, toCents } from '../common/money';

/**
 * Which statuses a requisition may move between, and nothing else.
 *
 * Stated as a table rather than scattered through `if`s: a lifecycle spelled out at each call site
 * is a lifecycle that ends up different at each call site.
 */
const REQUISITION_TRANSITIONS: Record<PurchaseRequisitionStatus, PurchaseRequisitionStatus[]> = {
  [PurchaseRequisitionStatus.DRAFT]: [PurchaseRequisitionStatus.PENDING_APPROVAL],
  [PurchaseRequisitionStatus.PENDING_APPROVAL]: [
    PurchaseRequisitionStatus.APPROVED,
    PurchaseRequisitionStatus.REJECTED,
    PurchaseRequisitionStatus.DRAFT,
  ],
  [PurchaseRequisitionStatus.APPROVED]: [PurchaseRequisitionStatus.CONVERTED_TO_PO],
  [PurchaseRequisitionStatus.REJECTED]: [PurchaseRequisitionStatus.DRAFT],
  [PurchaseRequisitionStatus.CONVERTED_TO_PO]: [],
};

/**
 * Purchase requisitions: somebody in the business asking to buy something.
 *
 * ## What this was
 *
 * A register of numbers. The entity carried a number, a requester, a status and a total, and
 * nothing that said what anybody wanted to buy — so a requisition could not be approved on its
 * merits, turned into an order, or matched against what arrived. The client screen did not call it
 * at all: it listed three requisitions invented in the browser, `REQ-001 Ana Pérez IT $2,500.00`
 * and two more, the same three for every tenant of the product.
 *
 * Requisitions now carry lines, are numbered by the server, total themselves from those lines, and
 * move through a stated lifecycle with the decision recorded — who approved it, when, and on
 * rejection why.
 */
@Injectable()
export class ProcurementService {
  private readonly logger = new Logger(ProcurementService.name);

  constructor(
    @InjectRepository(PurchaseRequisition)
    private readonly requisitionRepository: Repository<PurchaseRequisition>,
    private readonly dataSource: DataSource,
    private readonly numbering: JournalEntryNumberingService,
  ) {}

  async findAll(
    organizationId: string,
    query: { page?: number; pageSize?: number; status?: PurchaseRequisitionStatus } = {},
  ): Promise<Page<PurchaseRequisition>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const [rows, total] = await this.requisitionRepository.findAndCount({
      where: { organizationId, ...(query.status ? { status: query.status } : {}) },
      relations: ['lines'],
      order: { createdAt: 'DESC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  async findOne(id: string, organizationId: string): Promise<PurchaseRequisition> {
    const requisition = await this.requisitionRepository.findOne({
      where: { id, organizationId },
      relations: ['lines', 'lines.product'],
    });
    if (!requisition) {
      throw new NotFoundError('procurement.requisition_not_found', { id });
    }
    return requisition;
  }

  async create(
    dto: CreatePurchaseRequisitionDto,
    organizationId: string,
    requestedByUserId: string,
  ): Promise<PurchaseRequisition> {
    return this.dataSource.transaction(async (manager) => {
      const requisition = manager.create(PurchaseRequisition, {
        organizationId,
        requestedByUserId,
        number: await this.nextNumber(manager, organizationId),
        status: PurchaseRequisitionStatus.DRAFT,
        requiredDate: dto.requiredDate ?? null,
        notes: dto.notes ?? null,
        totalAmount: 0,
      } as Partial<PurchaseRequisition>);

      const saved = await manager.save(requisition);
      await this.replaceLines(manager, saved, dto.lines, organizationId);
      return this.findOneWithManager(manager, saved.id, organizationId);
    });
  }

  /**
   * Edit a requisition that has not yet been submitted.
   *
   * A document under review cannot change under the reviewer: an approver who agrees to one thing
   * and finds they authorised another has no reason to trust the approval queue again.
   */
  async update(
    id: string,
    dto: UpdatePurchaseRequisitionDto,
    organizationId: string,
  ): Promise<PurchaseRequisition> {
    return this.dataSource.transaction(async (manager) => {
      const requisition = await this.findOneWithManager(manager, id, organizationId);
      if (requisition.status !== PurchaseRequisitionStatus.DRAFT) {
        throw new BadRequestError('procurement.requisition_not_editable', {
          status: requisition.status,
        });
      }

      if (dto.requiredDate !== undefined) requisition.requiredDate = dto.requiredDate;
      if (dto.notes !== undefined) requisition.notes = dto.notes;
      await manager.save(requisition);

      if (dto.lines) {
        await this.replaceLines(manager, requisition, dto.lines, organizationId);
      }
      return this.findOneWithManager(manager, id, organizationId);
    });
  }

  /** Send it for approval. */
  submit(id: string, organizationId: string): Promise<PurchaseRequisition> {
    return this.transition(id, organizationId, PurchaseRequisitionStatus.PENDING_APPROVAL);
  }

  async approve(
    id: string,
    organizationId: string,
    actorUserId: string,
  ): Promise<PurchaseRequisition> {
    return this.transition(id, organizationId, PurchaseRequisitionStatus.APPROVED, (requisition) => {
      requisition.decidedByUserId = actorUserId;
      requisition.decidedAt = new Date();
      requisition.rejectionReason = null;
    });
  }

  async reject(
    id: string,
    organizationId: string,
    actorUserId: string,
    reason: string,
  ): Promise<PurchaseRequisition> {
    return this.transition(id, organizationId, PurchaseRequisitionStatus.REJECTED, (requisition) => {
      requisition.decidedByUserId = actorUserId;
      requisition.decidedAt = new Date();
      requisition.rejectionReason = reason;
    });
  }

  /** Send a rejected or in-review requisition back to its author to change. */
  reopen(id: string, organizationId: string): Promise<PurchaseRequisition> {
    return this.transition(id, organizationId, PurchaseRequisitionStatus.DRAFT, (requisition) => {
      requisition.decidedByUserId = null;
      requisition.decidedAt = null;
    });
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const requisition = await this.findOne(id, organizationId);
    // Only a draft disappears. Once it has been through an approver it is part of the record of
    // what the business decided, and deleting it erases their decision along with it.
    if (requisition.status !== PurchaseRequisitionStatus.DRAFT) {
      throw new BadRequestError('procurement.requisition_status_cannot_deleted_part_record', {
        status: requisition.status,
      });
    }
    await this.requisitionRepository.delete({ id, organizationId });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Used by the orders service when a requisition becomes an order. */
  async markConverted(
    manager: EntityManager,
    requisitionId: string,
    organizationId: string,
    purchaseOrderId: string,
  ): Promise<void> {
    const requisition = await this.findOneWithManager(manager, requisitionId, organizationId);
    this.assertTransition(requisition.status, PurchaseRequisitionStatus.CONVERTED_TO_PO);
    requisition.status = PurchaseRequisitionStatus.CONVERTED_TO_PO;
    requisition.purchaseOrderId = purchaseOrderId;
    await manager.save(requisition);
  }

  private async transition(
    id: string,
    organizationId: string,
    to: PurchaseRequisitionStatus,
    mutate?: (requisition: PurchaseRequisition) => void,
  ): Promise<PurchaseRequisition> {
    return this.dataSource.transaction(async (manager) => {
      const requisition = await this.findOneWithManager(manager, id, organizationId);
      this.assertTransition(requisition.status, to);
      requisition.status = to;
      mutate?.(requisition);
      await manager.save(requisition);
      this.logger.log(`Requisición ${requisition.number} → ${to}.`);
      return this.findOneWithManager(manager, id, organizationId);
    });
  }

  private assertTransition(from: PurchaseRequisitionStatus, to: PurchaseRequisitionStatus): void {
    if (!REQUISITION_TRANSITIONS[from].includes(to)) {
      throw new BadRequestError('procurement.requisition_cannot_move_from_from', { from, to });
    }
  }

  private async findOneWithManager(
    manager: EntityManager,
    id: string,
    organizationId: string,
  ): Promise<PurchaseRequisition> {
    const requisition = await manager.findOne(PurchaseRequisition, {
      where: { id, organizationId },
      relations: ['lines', 'lines.product'],
    });
    if (!requisition) {
      throw new NotFoundError('procurement.requisition_not_found', { id });
    }
    return requisition;
  }

  /**
   * Replace the lines wholesale and recompute the total.
   *
   * Wholesale rather than diffed: the form sends what the document should now say, and reconciling
   * that against what it used to say — deciding which line is "the same line" renamed — is a
   * guess. Deleting and reinserting is the honest reading of "this is the document now".
   */
  private async replaceLines(
    manager: EntityManager,
    requisition: PurchaseRequisition,
    lines: CreatePurchaseRequisitionDto['lines'],
    organizationId: string,
  ): Promise<void> {
    await manager.delete(PurchaseRequisitionLine, { requisitionId: requisition.id });

    let total = 0;
    const rows = lines.map((line, index) => {
      const amount = roundAmount(line.quantity * (line.estimatedUnitPrice ?? 0));
      total = roundAmount(total + amount);
      return manager.create(PurchaseRequisitionLine, {
        organizationId,
        requisitionId: requisition.id,
        productId: line.productId ?? null,
        description: line.description,
        quantity: line.quantity,
        estimatedUnitPrice: line.estimatedUnitPrice ?? 0,
        unitOfMeasure: line.unitOfMeasure ?? 'UND',
        sortOrder: index,
      });
    });
    await manager.save(rows);

    // `update`, not `save`: the entity in hand still carries the *old* lines in its relation, and
    // `cascade: true` would try to re-insert them alongside the ones just written.
    if (toCents(requisition.totalAmount) !== toCents(total)) {
      requisition.totalAmount = total;
      await manager.update(PurchaseRequisition, { id: requisition.id }, { totalAmount: total });
    }
  }

  private nextNumber(manager: EntityManager, organizationId: string): Promise<string> {
    return this.numbering.allocateForScope(
      manager,
      organizationId,
      SEQUENCE_SCOPE.PURCHASE_REQUISITION,
      'REQ',
      new Date().getFullYear(),
    );
  }
}
