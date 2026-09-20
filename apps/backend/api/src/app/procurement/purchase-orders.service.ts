import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PurchaseOrder, PurchaseOrderStatus } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { PurchaseRequisition } from './entities/purchase-requisition.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderLineDto,
  PurchaseOrderQueryDto,
  ReceivePurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { Page, resolvePaging, toPage } from '../common/pagination';
import {
  JournalEntryNumberingService,
  SEQUENCE_SCOPE,
} from '../journal-entries/journal-entry-numbering.service';
import { ProcurementService } from './procurement.service';
import { roundAmount, toCents } from '../common/money';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';
import { canTransition } from '@virteex/shared/types';
import { PURCHASE_ORDER_LIFECYCLE } from './procurement-lifecycles';

/** Once an order has been sent to a supplier, its terms are not ours alone to change. */
const EDITABLE = [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.PENDING_APPROVAL];

/**
 * Purchase orders.
 *
 * ## What existed
 *
 * Nothing at all. The purchasing screen listed four orders — `PO-2025-001 OfiSuministros SRL
 * $1,250.00 Sent` and three more — as literals in the browser bundle: the same four for every
 * tenant of the product, with no table behind them, no endpoint, and no way to create a fifth. A
 * buyer could look at the screen and not act on it.
 *
 * ## Why nothing here posts to the ledger
 *
 * A purchase order is a **commitment**, not a transaction. Nothing has been bought, nothing is owed
 * and nothing has moved until the goods or the invoice arrive; the ledger records what happened,
 * not what was agreed. The vendor bill already debits inventory and credits payables when it is
 * approved, and posting here as well would count every purchase twice.
 *
 * What the order does carry is the chain in both directions — the requisition it came from, and
 * what has been received against it — because that is what lets anyone answer "was this
 * authorised, and did we get what we ordered at the price we agreed?". That question is the entire
 * reason purchasing runs through a system rather than through email.
 */
@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    @InjectRepository(PurchaseOrder)
    private readonly orderRepository: Repository<PurchaseOrder>,
    private readonly dataSource: DataSource,
    private readonly numbering: JournalEntryNumberingService,
    private readonly requisitions: ProcurementService,
  ) {}

  async findAll(organizationId: string, query: PurchaseOrderQueryDto = {}): Promise<Page<PurchaseOrder>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const [rows, total] = await this.orderRepository.findAndCount({
      where: {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      },
      relations: ['supplier'],
      order: { orderDate: 'DESC', createdAt: 'DESC' },
      skip: paging.skip,
      take: paging.take,
    });
    return toPage(rows, total, paging);
  }

  findOne(id: string, organizationId: string): Promise<PurchaseOrder> {
    return this.findOneWith(this.dataSource.manager, id, organizationId);
  }

  async create(
    dto: CreatePurchaseOrderDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<PurchaseOrder> {
    return this.dataSource.transaction(async (manager) => {
      const supplier = await manager.findOneBy(Supplier, { id: dto.supplierId, organizationId });
      if (!supplier) throw new BadRequestError('procurement.supplier_not_found');

      const orderDate = toIsoDate(dto.orderDate ?? new Date());
      const order = await manager.save(
        manager.create(PurchaseOrder, {
          organizationId,
          number: await this.nextNumber(manager, organizationId, orderDate),
          supplierId: dto.supplierId,
          orderDate,
          expectedDate: dto.expectedDate ?? null,
          status: PurchaseOrderStatus.DRAFT,
          currencyCode: (dto.currencyCode ?? (await this.baseCurrency(manager, organizationId))).toUpperCase(),
          exchangeRate: 1,
          notes: dto.notes ?? null,
          createdByUserId: actorUserId,
        } as Partial<PurchaseOrder>),
      );

      await this.replaceLines(manager, order, dto.lines, organizationId);
      return this.findOneWith(manager, order.id, organizationId);
    });
  }

  async update(
    id: string,
    dto: UpdatePurchaseOrderDto,
    organizationId: string,
  ): Promise<PurchaseOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.findOneWith(manager, id, organizationId);
      if (!EDITABLE.includes(order.status)) {
        throw new BadRequestError('procurement.order_not_editable', { status: order.status });
      }

      if (dto.supplierId !== undefined) {
        const supplier = await manager.findOneBy(Supplier, { id: dto.supplierId, organizationId });
        if (!supplier) throw new BadRequestError('procurement.supplier_not_found');
        order.supplierId = dto.supplierId;
      }
      if (dto.orderDate !== undefined) order.orderDate = toIsoDate(dto.orderDate);
      if (dto.expectedDate !== undefined) order.expectedDate = dto.expectedDate;
      if (dto.currencyCode !== undefined) order.currencyCode = dto.currencyCode.toUpperCase();
      if (dto.notes !== undefined) order.notes = dto.notes;
      await manager.save(order);

      if (dto.lines) await this.replaceLines(manager, order, dto.lines, organizationId);
      return this.findOneWith(manager, id, organizationId);
    });
  }

  /**
   * Turn an approved requisition into an order to one supplier.
   *
   * The lines carry across with the requester's estimate as the opening price, because that is the
   * only figure anyone has until the supplier quotes; the buyer then edits it to what was actually
   * agreed. The requisition is marked converted and points at the order, so the authorisation and
   * the purchase stay attached to one another.
   */
  async createFromRequisition(
    requisitionId: string,
    supplierId: string,
    organizationId: string,
    actorUserId: string,
  ): Promise<PurchaseOrder> {
    return this.dataSource.transaction(async (manager) => {
      const requisition = await manager.findOne(PurchaseRequisition, {
        where: { id: requisitionId, organizationId },
        relations: ['lines'],
      });
      if (!requisition) throw new NotFoundError('procurement.requisition_not_found', { id: requisitionId });
      if (!requisition.lines?.length) {
        throw new BadRequestError('procurement.requisition_has_no_lines');
      }

      const order = await this.create(
        {
          supplierId,
          orderDate: toIsoDate(new Date()),
          expectedDate: requisition.requiredDate ?? undefined,
          notes: requisition.notes ?? undefined,
          lines: requisition.lines
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((line) => ({
              productId: line.productId ?? undefined,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.estimatedUnitPrice,
              unitOfMeasure: line.unitOfMeasure,
            })),
        },
        organizationId,
        actorUserId,
      );

      await manager.update(PurchaseOrder, { id: order.id }, { requisitionId });
      await this.requisitions.markConverted(manager, requisitionId, organizationId, order.id);
      return this.findOneWith(manager, order.id, organizationId);
    });
  }

  submit(id: string, organizationId: string): Promise<PurchaseOrder> {
    return this.transition(id, organizationId, PurchaseOrderStatus.PENDING_APPROVAL);
  }

  approve(id: string, organizationId: string, actorUserId: string): Promise<PurchaseOrder> {
    return this.transition(id, organizationId, PurchaseOrderStatus.APPROVED, (order) => {
      order.approvedByUserId = actorUserId;
      order.approvedAt = new Date();
    });
  }

  /** Mark it sent to the supplier: from here the terms are not ours alone to change. */
  send(id: string, organizationId: string): Promise<PurchaseOrder> {
    return this.transition(id, organizationId, PurchaseOrderStatus.SENT, (order) => {
      order.sentAt = new Date();
    });
  }

  reopen(id: string, organizationId: string): Promise<PurchaseOrder> {
    return this.transition(id, organizationId, PurchaseOrderStatus.DRAFT, (order) => {
      order.approvedByUserId = null;
      order.approvedAt = null;
    });
  }

  cancel(id: string, organizationId: string, reason: string): Promise<PurchaseOrder> {
    return this.transition(id, organizationId, PurchaseOrderStatus.CANCELLED, (order) => {
      order.cancelledAt = new Date();
      order.cancellationReason = reason;
    });
  }

  /**
   * Record what arrived.
   *
   * Quantities only: no ledger entry and no stock movement, because the vendor bill is what brings
   * the goods onto the books, and doing it here as well would double every purchase. What this
   * gives the buyer is the answer to "what is still outstanding", which the order could not answer
   * before.
   */
  async receive(
    id: string,
    dto: ReceivePurchaseOrderDto,
    organizationId: string,
  ): Promise<PurchaseOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.findOneWith(manager, id, organizationId);
      if (![PurchaseOrderStatus.SENT, PurchaseOrderStatus.PARTIALLY_RECEIVED].includes(order.status)) {
        throw new BadRequestError('procurement.order_not_receivable', { status: order.status });
      }

      const byId = new Map(order.lines.map((line) => [line.id, line]));
      for (const received of dto.lines) {
        const line = byId.get(received.lineId);
        if (!line) throw new BadRequestError('procurement.order_line_not_found', { id: received.lineId });

        const total = roundAmount(line.receivedQuantity + received.quantity);
        if (toCents(total) > toCents(line.quantity)) {
          throw new BadRequestError('procurement.receipt_exceeds_ordered', {
            description: line.description,
            ordered: line.quantity,
            received: total,
          });
        }
        line.receivedQuantity = total;
        await manager.save(line);
      }

      const fresh = await this.findOneWith(manager, id, organizationId);
      const complete = fresh.lines.every(
        (line) => toCents(line.receivedQuantity) >= toCents(line.quantity),
      );
      fresh.status = complete ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED;
      await manager.save(fresh);

      this.logger.log(`Orden ${fresh.number} → ${fresh.status}.`);
      return this.findOneWith(manager, id, organizationId);
    });
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const order = await this.findOne(id, organizationId);
    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestError('procurement.only_draft_order_can_deleted_one', { status: order.status });
    }
    await this.orderRepository.delete({ id, organizationId });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async transition(
    id: string,
    organizationId: string,
    to: PurchaseOrderStatus,
    mutate?: (order: PurchaseOrder) => void,
  ): Promise<PurchaseOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.findOneWith(manager, id, organizationId);
      // La regla está declarada, no copiada aquí: la misma que lee la pantalla para dibujar en
      // qué punto está la orden y qué puede pasarle después.
      if (!canTransition(PURCHASE_ORDER_LIFECYCLE, order.status, to)) {
        throw new BadRequestError('procurement.order_cannot_move_from_from', {
          from: order.status,
          to,
        });
      }
      order.status = to;
      mutate?.(order);
      await manager.save(order);
      this.logger.log(`Orden ${order.number} → ${to}.`);
      return this.findOneWith(manager, id, organizationId);
    });
  }

  private async findOneWith(
    manager: EntityManager,
    id: string,
    organizationId: string,
  ): Promise<PurchaseOrder> {
    const order = await manager.findOne(PurchaseOrder, {
      where: { id, organizationId },
      relations: ['lines', 'lines.product', 'supplier'],
      order: { lines: { sortOrder: 'ASC' } },
    });
    if (!order) throw new NotFoundError('procurement.order_not_found', { id });
    return order;
  }

  /** Wholesale replacement, and the document totals itself from what it now says. */
  private async replaceLines(
    manager: EntityManager,
    order: PurchaseOrder,
    lines: PurchaseOrderLineDto[],
    organizationId: string,
  ): Promise<void> {
    await manager.delete(PurchaseOrderLine, { orderId: order.id });

    let subtotal = 0;
    let taxTotal = 0;
    const rows = lines.map((line, index) => {
      const amount = roundAmount(line.quantity * line.unitPrice);
      const tax = roundAmount(amount * (line.taxRate ?? 0));
      subtotal = roundAmount(subtotal + amount);
      taxTotal = roundAmount(taxTotal + tax);
      return manager.create(PurchaseOrderLine, {
        organizationId,
        orderId: order.id,
        productId: line.productId ?? null,
        description: line.description,
        quantity: line.quantity,
        receivedQuantity: 0,
        unitPrice: line.unitPrice,
        taxRate: line.taxRate ?? 0,
        unitOfMeasure: line.unitOfMeasure ?? 'UND',
        sortOrder: index,
      });
    });
    await manager.save(rows);

    // `update`, not `save`: the entity in hand still carries the *old* lines in its relation, and
    // `cascade: true` would try to re-insert them alongside the ones just written.
    order.subtotal = subtotal;
    order.taxTotal = taxTotal;
    order.total = roundAmount(subtotal + taxTotal);
    await manager.update(
      PurchaseOrder,
      { id: order.id },
      { subtotal, taxTotal, total: order.total },
    );
  }

  private async baseCurrency(manager: EntityManager, organizationId: string): Promise<string> {
    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    return settings?.baseCurrency ?? 'USD';
  }

  private nextNumber(
    manager: EntityManager,
    organizationId: string,
    orderDate: string,
  ): Promise<string> {
    return this.numbering.allocateForScope(
      manager,
      organizationId,
      SEQUENCE_SCOPE.PURCHASE_ORDER,
      'PO',
      Number(orderDate.slice(0, 4)),
    );
  }
}
