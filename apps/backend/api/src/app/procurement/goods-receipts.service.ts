import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GoodsReceiptStatus, PurchaseOrderReceipt } from './entities/purchase-order-receipt.entity';
import { PurchaseOrder, PurchaseOrderStatus } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { CreateGoodsReceiptDto, GoodsReceiptQueryDto, VoidGoodsReceiptDto } from './dto/goods-receipt.dto';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GoodsReceiptPort } from '../inventory/contracts/goods-receipt.contract';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { applyBranchScope, assertDocumentInScope, loadBranchScope } from '../organizations/contracts/branch.contract';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';

/** Quantities carry six decimals; comparisons tolerate the last one. */
const QUANTITY_EPSILON = 0.000001;
const roundQuantity = (value: number): number => Math.round(value * 1e6) / 1e6;

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/** A receipt as the list shows it. */
export interface GoodsReceiptRow {
  id: string;
  number: string;
  receivedAt: string;
  status: GoodsReceiptStatus;
  orderId: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string | null;
  warehouseId: string | null;
  branchId: string | null;
  journalEntryId: string | null;
  lineCount: number;
  /** In the books' currency, at the cost each line came in at. */
  value: number;
}

/** One line of a receipt as the document shows it: what arrived, and how much of it was billed. */
export interface GoodsReceiptLineView {
  lineId: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  value: number;
  stocked: boolean;
  ordered: number | null;
  receivedOnOrder: number | null;
  billedOnOrder: number | null;
}

export interface GoodsReceiptView {
  id: string;
  number: string;
  status: GoodsReceiptStatus;
  receivedAt: string;
  receivedByUserId: string | null;
  orderId: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string | null;
  currencyCode: string;
  warehouseId: string | null;
  branchId: string | null;
  notes: string | null;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  voidReason: string | null;
  voidedAt: Date | null;
  value: number;
  lines: GoodsReceiptLineView[];
}

/**
 * Goods receipts as documents (audit H-03).
 *
 * A delivery was recorded from inside the purchase order and kept as a row nobody could list, open
 * or undo. It is the document Odoo calls a *Receipt*, NetSuite an *Item Receipt* and SAP a goods
 * receipt (MIGO 101): what the three-way match pairs with the supplier's bill, and what moved the
 * stock. Here it gets its list, its own page, and a void (MIGO 102) — refused once any of it has
 * been billed, because the bill already cleared «received not invoiced» for those goods.
 */
@Injectable()
export class GoodsReceiptsService {
  private readonly logger = new Logger(GoodsReceiptsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orders: PurchaseOrdersService,
    private readonly inventory: GoodsReceiptPort,
  ) {}

  /** Record a delivery against an order and answer with the receipt it became. */
  async create(dto: CreateGoodsReceiptDto, organizationId: string, actorUserId: string): Promise<GoodsReceiptView> {
    const { orderId, ...delivery } = dto;
    // Opening the order checks the person can see its branch.
    await this.orders.findOne(orderId, organizationId, actorUserId);
    const { receipt } = await this.orders.receiveDocument(orderId, delivery, organizationId, actorUserId);
    return this.findOne(receipt.id, organizationId);
  }

  async findAll(
    organizationId: string,
    query: GoodsReceiptQueryDto = {},
    actorUserId?: string,
  ): Promise<Paged<GoodsReceiptRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const qb = this.dataSource.manager
      .createQueryBuilder(PurchaseOrderReceipt, 'receipt')
      .innerJoin('receipt.order', 'order')
      .leftJoin('order.supplier', 'supplier')
      .where('receipt.organizationId = :organizationId', { organizationId });
    if (query.supplierId) qb.andWhere('order.supplierId = :supplierId', { supplierId: query.supplierId });
    if (query.orderId) qb.andWhere('receipt.orderId = :orderId', { orderId: query.orderId });
    if (query.warehouseId) qb.andWhere('receipt.warehouseId = :warehouseId', { warehouseId: query.warehouseId });
    if (query.status) qb.andWhere('receipt.status = :status', { status: query.status });
    if (query.from) qb.andWhere('receipt.receivedAt >= :from', { from: `${query.from.slice(0, 10)}T00:00:00.000Z` });
    if (query.to) qb.andWhere(`receipt.receivedAt < CAST(:to AS date) + 1`, { to: query.to.slice(0, 10) });
    if (actorUserId || query.branchId) {
      const scope = await loadBranchScope(this.dataSource.manager, organizationId, actorUserId ?? null);
      applyBranchScope(qb, 'receipt', scope, query.branchId);
    }

    const total = await qb.getCount();
    const rows = await qb
      .select([
        'receipt.id AS "id"',
        'receipt.number AS "number"',
        'receipt.receivedAt AS "receivedAt"',
        'receipt.status AS "status"',
        'receipt.orderId AS "orderId"',
        'order.number AS "orderNumber"',
        'order.supplierId AS "supplierId"',
        'supplier.name AS "supplierName"',
        'receipt.warehouseId AS "warehouseId"',
        'receipt.branchId AS "branchId"',
        'receipt.journalEntryId AS "journalEntryId"',
      ])
      .addSelect('jsonb_array_length(receipt.lines)', 'lineCount')
      .addSelect(
        `(SELECT COALESCE(SUM((l->>'quantity')::numeric * (l->>'unitCost')::numeric), 0)
            FROM jsonb_array_elements(receipt.lines) l)`,
        'value',
      )
      .orderBy('receipt.receivedAt', 'DESC')
      .addOrderBy('receipt.number', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<GoodsReceiptRow>();

    const items = rows.map((row) => ({
      ...row,
      receivedAt: new Date(row.receivedAt).toISOString(),
      lineCount: Number(row.lineCount),
      value: Math.round(Number(row.value) * 100) / 100,
    }));
    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  async findOne(id: string, organizationId: string, actorUserId?: string): Promise<GoodsReceiptView> {
    const receipt = await this.dataSource.manager.findOne(PurchaseOrderReceipt, {
      where: { id, organizationId },
      relations: ['order', 'order.supplier', 'order.lines'],
    });
    if (!receipt || !receipt.order) throw new NotFoundError('procurement.receipt_not_found');
    if (actorUserId) {
      assertDocumentInScope(await loadBranchScope(this.dataSource.manager, organizationId, actorUserId), receipt.branchId);
    }
    const orderLines = new Map((receipt.order.lines ?? []).map((line) => [line.id, line]));
    const lines = (receipt.lines ?? []).map((line) => {
      const ordered = orderLines.get(line.lineId);
      return {
        ...line,
        value: Math.round(line.quantity * line.unitCost * 100) / 100,
        ordered: ordered ? Number(ordered.quantity) : null,
        receivedOnOrder: ordered ? Number(ordered.receivedQuantity) : null,
        billedOnOrder: ordered ? Number(ordered.billedQuantity) : null,
      };
    });
    return {
      id: receipt.id,
      number: receipt.number,
      status: receipt.status,
      receivedAt: new Date(receipt.receivedAt).toISOString(),
      receivedByUserId: receipt.receivedByUserId,
      orderId: receipt.orderId,
      orderNumber: receipt.order.number,
      supplierId: receipt.order.supplierId,
      supplierName: receipt.order.supplier?.name ?? null,
      currencyCode: receipt.order.currencyCode,
      warehouseId: receipt.warehouseId,
      branchId: receipt.branchId,
      notes: receipt.notes,
      journalEntryId: receipt.journalEntryId,
      reversalJournalEntryId: receipt.reversalJournalEntryId,
      voidReason: receipt.voidReason,
      voidedAt: receipt.voidedAt,
      value: Math.round(lines.reduce((sum, line) => sum + line.value, 0) * 100) / 100,
      lines,
    };
  }

  /**
   * Undo a receipt: the goods go back out of the warehouse at the cost they came in at, the
   * receipt's entry is reversed, and the order is owed those quantities again.
   *
   * Refused when any of the receipt has been billed — the bill cleared «received not invoiced»
   * for it, so un-receiving would leave that account short — and, by the stock ledger, when the
   * warehouse no longer holds the goods: what was received and then sold cannot be un-received.
   * Both are the cases where a *return to the supplier* (a debit note) is the right document.
   */
  async voidReceipt(
    id: string,
    dto: VoidGoodsReceiptDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<GoodsReceiptView> {
    const reason = dto.reason.trim();
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT "id" FROM "purchase_order_receipts" WHERE "id" = $1 AND "organization_id" = $2 FOR UPDATE`,
        [id, organizationId],
      );
      const receipt = await manager.findOne(PurchaseOrderReceipt, { where: { id, organizationId } });
      if (!receipt) throw new NotFoundError('procurement.receipt_not_found');
      if (receipt.status === GoodsReceiptStatus.VOID) {
        throw new ConflictError('procurement.receipt_already_voided', { number: receipt.number });
      }

      // The order's lines, locked: a bill matched against them right now must wait for this.
      await manager.query(
        `SELECT "id" FROM "purchase_order_lines" WHERE "order_id" = $1 ORDER BY "id" FOR UPDATE`,
        [receipt.orderId],
      );
      const order = await manager.findOne(PurchaseOrder, {
        where: { id: receipt.orderId, organizationId },
        relations: ['lines'],
      });
      if (!order) throw new NotFoundError('procurement.order_not_found');
      const byId = new Map(order.lines.map((line) => [line.id, line]));

      for (const line of receipt.lines) {
        const orderLine = byId.get(line.lineId);
        if (!orderLine) continue;
        const remaining = roundQuantity(Number(orderLine.receivedQuantity) - line.quantity);
        if (Number(orderLine.billedQuantity) - remaining > QUANTITY_EPSILON) {
          throw new BadRequestError('procurement.receipt_already_billed', {
            number: receipt.number,
            description: orderLine.description,
          });
        }
      }

      const date = dto.reversalDate ? dto.reversalDate.slice(0, 10) : await organizationToday(manager, organizationId);
      const reversalJournalEntryId = await this.inventory.returnGoods(
        manager,
        organizationId,
        {
          reference: receipt.number,
          sourceType: 'purchase_order_receipt',
          sourceId: receipt.id,
          date,
          reason: `Anulación de recepción ${receipt.number}: ${reason}`,
          warehouseId: receipt.warehouseId,
          posted: receipt.journalEntryId !== null,
          lines: receipt.lines
            .filter((line) => line.stocked && line.productId)
            .map((line) => ({ productId: line.productId as string, quantity: line.quantity, unitCost: line.unitCost })),
        },
        actorUserId,
      );

      for (const line of receipt.lines) {
        const orderLine = byId.get(line.lineId);
        if (!orderLine) continue;
        orderLine.receivedQuantity = Math.max(0, roundQuantity(Number(orderLine.receivedQuantity) - line.quantity));
        await manager.save(PurchaseOrderLine, orderLine);
      }
      // The order is owed those goods again — unless it was cancelled meanwhile, which stays.
      if (order.status === PurchaseOrderStatus.RECEIVED || order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED) {
        const anyReceived = order.lines.some((line) => Number(line.receivedQuantity) > QUANTITY_EPSILON);
        await manager.update(
          PurchaseOrder,
          { id: order.id, organizationId },
          { status: anyReceived ? PurchaseOrderStatus.PARTIALLY_RECEIVED : PurchaseOrderStatus.SENT },
        );
      }

      receipt.status = GoodsReceiptStatus.VOID;
      receipt.voidReason = reason;
      receipt.voidedAt = new Date();
      receipt.voidedByUserId = actorUserId;
      receipt.reversalJournalEntryId = reversalJournalEntryId;
      await manager.save(PurchaseOrderReceipt, receipt);
      this.logger.log(`Recepción ${receipt.number} anulada: ${reason}.`);
    });
    return this.findOne(id, organizationId);
  }
}
