import { Injectable, Logger, Optional } from '@nestjs/common';
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
import { BadRequestError, ForbiddenError, NotFoundError } from '../i18n/localized.exception';
import { GoodsReceiptStatus, PurchaseOrderReceipt } from './entities/purchase-order-receipt.entity';
import { GoodsReceiptPort } from '../inventory/contracts/goods-receipt.contract';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { Page, resolvePaging, toPage } from '../common/pagination';
import { allocateDocumentNumber, DOCUMENT_SEQUENCE_SCOPE } from '../shared/numbering/document-numbers';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { ProcurementService } from './procurement.service';
import { roundAmount, toCents } from '../common/money';
import { toIsoDate } from '../common/dates';
import { canTransition } from '@virteex/shared/types';
import { PURCHASE_ORDER_LIFECYCLE } from './procurement-lifecycles';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { APPROVAL_DECIDED, APPROVAL_REQUESTED, ApprovalDecidedEvent, ApprovalRequestedEvent } from '../workflows/events/approval.events';
import { PERMISSIONS } from '../shared/permissions';
import { applyBranchScope, assertDocumentInScope, loadBranchScope, reassignDocumentBranch, resolveDocumentBranch } from '../organizations/contracts/branch.contract';

/** Quantities carry six decimals; comparisons tolerate the last one. */
const QUANTITY_EPSILON = 0.000001;
const roundQuantity = (value: number): number => Math.round(value * 1e6) / 1e6;

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
 * ## What posts to the ledger, and what does not
 *
 * A purchase order is a **commitment**, not a transaction: creating, approving or sending one
 * posts nothing. A **receipt** is a transaction — the goods arrived — and posts
 * Dr Inventory / Cr Goods received not invoiced. The vendor bill raised against the order then
 * clears that bridge (Dr GRNI / Cr Payables) instead of debiting inventory again, so a purchase is
 * booked exactly once whichever document comes first.
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
    private readonly requisitions: ProcurementService,
    private readonly inventory: GoodsReceiptPort,
    // Optional only so the suites that build this service by hand for domestic orders keep
    // compiling; the application always injects it.
    @Optional() private readonly exchangeRates?: ExchangeRateResolver,
    /** Who must approve, and who asked, are told (QA B-02). Optional for hand-built suites. */
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  private announceRequested(order: PurchaseOrder, requestedByUserId: string | null): void {
    const event: ApprovalRequestedEvent = {
      organizationId: order.organizationId,
      requestId: order.id,
      documentType: 'PURCHASE_ORDER',
      documentId: order.id,
      amount: Number(order.total),
      currencyCode: order.currencyCode,
      reference: order.number,
      permission: PERMISSIONS.PROCUREMENT_APPROVE,
      requestedByUserId,
    };
    this.events?.emit(APPROVAL_REQUESTED, event);
  }

  private announceDecided(
    order: PurchaseOrder,
    decision: 'APPROVED' | 'REJECTED',
    actorUserId: string,
    reason?: string,
  ): void {
    const event: ApprovalDecidedEvent = {
      organizationId: order.organizationId,
      requestId: order.id,
      documentType: 'PURCHASE_ORDER',
      documentId: order.id,
      decision,
      requestedByUserId: order.createdByUserId ?? null,
      actorUserId,
      reason: reason ?? null,
      reference: order.number,
    };
    this.events?.emit(APPROVAL_DECIDED, event);
  }

  async findAll(
    organizationId: string,
    query: PurchaseOrderQueryDto = {},
    actorUserId?: string,
  ): Promise<Page<PurchaseOrder>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const builder = this.orderRepository
      .createQueryBuilder('po')
      .leftJoinAndSelect('po.supplier', 'supplier')
      .where('po.organizationId = :organizationId', { organizationId });
    if (query.status) builder.andWhere('po.status = :status', { status: query.status });
    if (query.supplierId) builder.andWhere('po.supplierId = :supplierId', { supplierId: query.supplierId });
    if (query.receivable) {
      builder.andWhere('po.status IN (:...receivable)', {
        receivable: [PurchaseOrderStatus.SENT, PurchaseOrderStatus.PARTIALLY_RECEIVED],
      });
    }
    if (actorUserId || query.branchId) {
      const scope = await loadBranchScope(this.dataSource.manager, organizationId, actorUserId ?? null);
      applyBranchScope(builder, 'po', scope, query.branchId);
    }
    const [rows, total] = await builder
      .orderBy('po.orderDate', 'DESC')
      .addOrderBy('po.createdAt', 'DESC')
      .skip(paging.skip)
      .take(paging.take)
      .getManyAndCount();
    return toPage(rows, total, paging);
  }

  async findOne(id: string, organizationId: string, actorUserId?: string): Promise<PurchaseOrder> {
    const order = await this.findOneWith(this.dataSource.manager, id, organizationId);
    if (actorUserId) {
      assertDocumentInScope(await loadBranchScope(this.dataSource.manager, organizationId, actorUserId), order.branchId);
    }
    return order;
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
          branchId: await resolveDocumentBranch(manager, organizationId, actorUserId, dto.branchId),
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
    actorUserId: string | null = null,
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
      order.branchId = await reassignDocumentBranch(manager, organizationId, actorUserId, order.branchId, dto.branchId);
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

  async submit(id: string, organizationId: string, actorUserId: string | null = null): Promise<PurchaseOrder> {
    const order = await this.transition(id, organizationId, PurchaseOrderStatus.PENDING_APPROVAL, (order) => {
      // A resubmission answers the previous rejection; its reason is history, not the status now.
      order.rejectionReason = null;
      order.rejectedByUserId = null;
      order.rejectedAt = null;
    });
    // After the commit: approvers are told about an order that is really waiting for them.
    this.announceRequested(order, actorUserId ?? order.createdByUserId ?? null);
    return order;
  }

  /**
   * Send an order awaiting approval back to its author, saying why (QA A-11).
   *
   * There was no way to refuse an order: only «reopen», which returned it to draft without a word,
   * so the requester could not tell a rejection from an edit. A rejection now carries its reason and
   * its author, and the order goes back to draft to be corrected and resubmitted — the same
   * contract as a rejected requisition.
   */
  async reject(id: string, organizationId: string, actorUserId: string, reason: string): Promise<PurchaseOrder> {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new BadRequestError('procurement.rejection_reason_required');
    const rejected = await this.dataSource.transaction(async (manager) => {
      const order = await this.findOneWith(manager, id, organizationId);
      if (order.status !== PurchaseOrderStatus.PENDING_APPROVAL) {
        throw new BadRequestError('procurement.only_pending_order_can_be_rejected', { status: order.status });
      }
      order.status = PurchaseOrderStatus.DRAFT;
      order.rejectionReason = trimmed;
      order.rejectedByUserId = actorUserId;
      order.rejectedAt = new Date();
      await manager.save(order);
      this.logger.log(`Orden ${order.number} rechazada.`);
      return this.findOneWith(manager, id, organizationId);
    });
    this.announceDecided(rejected, 'REJECTED', actorUserId, trimmed);
    return rejected;
  }

  /**
   * Approve an order — never your own (QA M-08).
   *
   * Whoever raised an order could approve it, which makes the approval a formality: the control
   * exists so that a second person agrees to spend the money. Payroll already enforces this split;
   * purchasing now does too. A company run by a single person has nobody else to ask, so the rule
   * applies only while the organization has another member who could approve.
   */
  async approve(id: string, organizationId: string, actorUserId: string): Promise<PurchaseOrder> {
    const approved = await this.transition(id, organizationId, PurchaseOrderStatus.APPROVED, async (order, manager) => {
      if (order.createdByUserId && order.createdByUserId === actorUserId) {
        const others: Array<{ count: string }> = await manager.query(
          'SELECT COUNT(*)::int AS count FROM user_organizations WHERE organization_id = $1 AND user_id <> $2',
          [organizationId, actorUserId],
        );
        if (Number(others[0]?.count ?? 0) > 0) {
          throw new ForbiddenError('procurement.cannot_approve_own_order');
        }
      }
      order.approvedByUserId = actorUserId;
      order.approvedAt = new Date();
    });
    this.announceDecided(approved, 'APPROVED', actorUserId);
    return approved;
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
   * Record what arrived, and bring it into stock and onto the books (QA C-07).
   *
   * This used to count quantities and nothing else: the order read "Recibida · 10" while the
   * product's stock did not move, the stock ledger stayed empty and the ledger never heard of the
   * goods. A receipt is the moment the goods physically arrive, so it is where they enter stock.
   *
   * Each call is one delivery and may be partial: every line says how much of it arrived, and a
   * line may be omitted. What arrives is valued at the agreed price converted at the order's rate,
   * re-averages the item's unit cost, writes a stock-ledger line and posts
   * Dr Inventory / Cr Goods received not invoiced. The supplier's invoice, raised against the order,
   * clears that bridge instead of receiving the goods a second time — see
   * `AccountsPayableService.approve`. All of it is one transaction.
   *
   * `lines` empty or omitted means "everything that is still outstanding", which is what the
   * one-click "Registrar recepción" did — now with its effects.
   */
  async receive(
    id: string,
    dto: ReceivePurchaseOrderDto,
    organizationId: string,
    actorUserId: string | null = null,
  ): Promise<PurchaseOrder> {
    return (await this.receiveDocument(id, dto, organizationId, actorUserId)).order;
  }

  /**
   * The same delivery, answered with the receipt it created — what `POST procurement/receipts`
   * returns, so the screen that records a delivery can open the document it just made.
   */
  async receiveDocument(
    id: string,
    dto: ReceivePurchaseOrderDto,
    organizationId: string,
    actorUserId: string | null = null,
  ): Promise<{ order: PurchaseOrder; receipt: PurchaseOrderReceipt }> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.findOneWith(manager, id, organizationId);
      if (![PurchaseOrderStatus.SENT, PurchaseOrderStatus.PARTIALLY_RECEIVED].includes(order.status)) {
        throw new BadRequestError('procurement.order_not_receivable', { status: order.status });
      }

      const byId = new Map(order.lines.map((line) => [line.id, line]));
      const requested = dto.lines?.length
        ? dto.lines
        : order.lines.map((line) => ({
            lineId: line.id,
            quantity: roundQuantity(line.quantity - line.receivedQuantity),
          }));

      // The day the goods arrived, as the company's books read it — not the server's UTC date.
      const receivedOn = dto.receivedAt ? toIsoDate(dto.receivedAt) : await organizationToday(manager, organizationId);
      const rate = await this.receiptRate(manager, order, organizationId, receivedOn);
      const arriving: Array<{ line: PurchaseOrderLine; quantity: number; unitCost: number }> = [];
      for (const received of requested) {
        const line = byId.get(received.lineId);
        if (!line) throw new BadRequestError('procurement.order_line_not_found', { id: received.lineId });
        if (received.quantity <= 0) continue;

        const total = roundQuantity(line.receivedQuantity + received.quantity);
        if (total - line.quantity > QUANTITY_EPSILON) {
          throw new BadRequestError('procurement.receipt_exceeds_ordered', {
            description: line.description,
            ordered: line.quantity,
            received: total,
          });
        }
        arriving.push({
          line,
          quantity: received.quantity,
          unitCost: Math.round(line.unitPrice * rate * 1e6) / 1e6,
        });
      }
      if (arriving.length === 0) {
        throw new BadRequestError('procurement.receipt_has_no_quantities');
      }

      // The receipt row first, so the stock ledger and the entry can name it.
      const receipt = await manager.save(
        manager.create(PurchaseOrderReceipt, {
          organizationId,
          // Received where it was ordered: the order already names the branch the goods go to.
          branchId: order.branchId,
          orderId: order.id,
          number: await allocateDocumentNumber(
            manager,
            organizationId,
            DOCUMENT_SEQUENCE_SCOPE.GOODS_RECEIPT,
            'GR',
            Number(receivedOn.slice(0, 4)),
          ),
          status: GoodsReceiptStatus.POSTED,
          // The instant it was recorded when that is the day it arrived; otherwise the day stated.
          // It used to be `new Date()` whatever date was given, so a delivery recorded a day late
          // read as arriving the day it was typed while its entry said otherwise.
          receivedAt: dto.receivedAt ? new Date(`${receivedOn}T12:00:00.000Z`) : new Date(),
          receivedByUserId: actorUserId,
          notes: dto.notes ?? null,
          lines: [],
        }),
      );

      const { journalEntryId, stocked, warehouseId } = await this.inventory.receiveGoods(
        manager,
        organizationId,
        {
          reference: order.number,
          sourceType: 'purchase_order_receipt',
          sourceId: receipt.id,
          date: receivedOn,
          place: { warehouseId: dto.warehouseId ?? null, branchId: order.branchId },
          lines: arriving.map(({ line, quantity, unitCost }) => ({
            productId: line.productId,
            quantity,
            unitCost,
            description: line.description,
          })),
        },
        actorUserId,
      );

      for (const { line, quantity } of arriving) {
        line.receivedQuantity = roundQuantity(line.receivedQuantity + quantity);
        await manager.save(line);
      }

      receipt.journalEntryId = journalEntryId;
      receipt.warehouseId = warehouseId;
      receipt.lines = arriving.map(({ line, quantity, unitCost }, index) => ({
        lineId: line.id,
        productId: line.productId,
        description: line.description,
        quantity,
        unitCost,
        stocked: stocked[index] ?? false,
      }));
      await manager.save(receipt);

      const fresh = await this.findOneWith(manager, id, organizationId);
      const complete = fresh.lines.every(
        (line) => line.quantity - line.receivedQuantity <= QUANTITY_EPSILON,
      );
      fresh.status = complete ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED;
      await manager.save(fresh);

      this.logger.log(
        `Orden ${fresh.number} → ${fresh.status}; recepción ${receipt.number}, asiento ${journalEntryId ?? '—'}.`,
      );
      return { order: await this.findOneWith(manager, id, organizationId), receipt };
    });
  }

  /** The deliveries recorded against an order, newest first. */
  async receipts(id: string, organizationId: string): Promise<PurchaseOrderReceipt[]> {
    await this.findOne(id, organizationId);
    return this.dataSource.manager.find(PurchaseOrderReceipt, {
      where: { orderId: id, organizationId },
      order: { receivedAt: 'DESC' },
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
    mutate?: (order: PurchaseOrder, manager: EntityManager) => void | Promise<void>,
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
      await mutate?.(order, manager);
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

  /**
   * Units of the books currency per unit of the order's currency, for goods arriving on `date`.
   *
   * The order stored `exchangeRate: 1` whatever its currency, and the receipt costed every line at
   * that: a EUR 1,000 order entered stock, and the ledger, as 1,000 pesos. Under IAS 21 a
   * foreign-currency purchase is measured at the spot rate of the transaction date — the day the
   * goods arrive — so the rate is resolved then, under the tenant's own rate policy (type, maximum
   * age of the quote), and recorded on the order as the last rate applied.
   */
  private async receiptRate(
    manager: EntityManager,
    order: PurchaseOrder,
    organizationId: string,
    date: string,
  ): Promise<number> {
    const base = (await this.baseCurrency(manager, organizationId)).toUpperCase();
    const currency = (order.currencyCode ?? base).toUpperCase();
    if (currency === base) return 1;
    if (!this.exchangeRates) {
      throw new BadRequestError('procurement.exchange_rate_unavailable', { from: currency, to: base, date });
    }
    const resolved = await this.exchangeRates.resolveForPosting(manager, organizationId, currency, base, date, null);
    if (Number(order.exchangeRate) !== resolved.rate) {
      await manager.update(PurchaseOrder, { id: order.id }, { exchangeRate: resolved.rate });
    }
    return resolved.rate;
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
    return allocateDocumentNumber(
      manager,
      organizationId,
      DOCUMENT_SEQUENCE_SCOPE.PURCHASE_ORDER,
      'PO',
      Number(orderDate.slice(0, 4)),
    );
  }
}
