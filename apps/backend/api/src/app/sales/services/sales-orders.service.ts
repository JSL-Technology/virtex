import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { InvoicesService } from '../../invoices/invoices.service';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { CreateInvoiceDto } from '../../invoices/dto/create-invoice.dto';
import { StockDispatchPort } from '../../inventory/contracts/stock-dispatch.contract';
import { findSellableProduct, isStockedProduct } from '../../inventory/contracts/sellable-product.contract';
import { Customer } from '../../customers/entities/customer.entity';
import { organizationToday } from '../../organizations/contracts/fiscal-today.contract';
import { organizationBaseCurrency } from '../../organizations/contracts/base-currency.contract';
import { resolveDocumentBranch } from '../../organizations/contracts/branch.contract';
import { DOCUMENT_SEQUENCE_SCOPE, allocateDocumentNumber } from '../../shared/numbering/document-numbers';
import { BadRequestError, ConflictError, NotFoundError } from '../../i18n/localized.exception';
import { Quote, QuoteStatus } from '../entities/quote.entity';
import { SalesOrder, SalesOrderStatus } from '../entities/sales-order.entity';
import { SalesOrderLine } from '../entities/sales-order-line.entity';
import { DeliveryNote, DeliveryNoteStatus } from '../entities/delivery-note.entity';
import { DeliveryNoteLine } from '../entities/delivery-note-line.entity';

/** Quantities are compared to six decimals, as they are stored. */
const EPSILON = 1e-6;

export interface SalesOrderLineInput {
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice?: number | null;
  discountRate?: number | null;
}

export interface CreateSalesOrderInput {
  customerId: string;
  branchId?: string | null;
  orderDate?: string;
  expectedDate?: string | null;
  currencyCode?: string | null;
  customerReference?: string | null;
  notes?: string | null;
  lines: SalesOrderLineInput[];
}

export interface DeliverInput {
  deliveryDate?: string;
  lines: Array<{ orderLineId: string; quantity: number }>;
  driverName?: string | null;
  vehiclePlate?: string | null;
  deliveryAddress?: string | null;
  receivedBy?: string | null;
  notes?: string | null;
}

export interface SalesOrderView extends SalesOrder {
  deliveries: DeliveryNote[];
  /** What a «Facturar» would bill now, per line: delivered goods and ordered services not yet invoiced. */
  invoiceable: Array<{ orderLineId: string; quantity: number }>;
}

/**
 * Sales orders and their conduces: order → delivery (stock moves) → invoice (the delivered goods,
 * the stock NOT moved again).
 *
 * The distributor's cycle the product could not record: a customer orders 100 cases, they leave in
 * three trucks on three days, each with its conduce signed at the door, and the month's deliveries
 * are invoiced together. The only path was quote → invoice, and the invoice moved the stock — so
 * the warehouse was right only on the day of invoicing, and a partial delivery could not exist.
 *
 * Every transition locks the order row, so two people delivering or invoicing the same order at
 * once cannot both take the same remaining quantity.
 */
@Injectable()
export class SalesOrdersService {
  private readonly logger = new Logger(SalesOrdersService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoices: InvoicesService,
    private readonly inventory: StockDispatchPort,
  ) {}

  // ── Orders ─────────────────────────────────────────────────────────────────

  async create(input: CreateSalesOrderInput, organizationId: string, actorUserId: string, quoteId: string | null = null): Promise<SalesOrder> {
    if (!input.lines?.length) throw new BadRequestError('sales.orders.no_lines');
    for (const line of input.lines) {
      if (!(Number(line.quantity) > 0)) throw new BadRequestError('sales.orders.quantity_positive');
    }
    const orderDate = input.orderDate ?? (await organizationToday(this.dataSource.manager, organizationId));
    if (input.expectedDate && input.expectedDate < orderDate) throw new BadRequestError('sales.orders.expected_before_order');

    // Priced by the same engine that will price the invoice, so the order shows what will be billed.
    const computed = await this.invoices.preview(
      {
        customerId: input.customerId,
        issueDate: orderDate,
        dueDate: orderDate,
        currencyCode: input.currencyCode ?? undefined,
        lineItems: input.lines.map((line) => ({
          productId: line.productId ?? undefined,
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: line.unitPrice ?? undefined,
          discountRate: line.discountRate ?? undefined,
        })),
      } as CreateInvoiceDto,
      organizationId,
    );

    return this.dataSource.transaction(async (manager) => {
      const customer = await manager.findOne(Customer, { where: { id: input.customerId, organizationId } });
      if (!customer) throw new NotFoundError('customers.customer_not_found');
      const branchId = await resolveDocumentBranch(manager, organizationId, actorUserId, input.branchId ?? undefined);
      const currencyCode = (input.currencyCode ?? (await organizationBaseCurrency(manager, organizationId))).toUpperCase();
      const lines: SalesOrderLine[] = [];
      for (const [index, line] of input.lines.entries()) {
        const result = computed.lines[index];
        lines.push(
          manager.create(SalesOrderLine, {
            lineOrder: index,
            productId: line.productId ?? null,
            description: (line.description ?? '').trim().slice(0, 500),
            isStocked: line.productId ? await isStockedProduct(manager, organizationId, line.productId) : false,
            quantity: Number(line.quantity),
            deliveredQuantity: 0,
            invoicedQuantity: 0,
            // The catalogue price when the order states none: the same one the preview priced with.
            unitPrice: Number(
              line.unitPrice ??
                (line.productId ? (await findSellableProduct(manager, organizationId, line.productId))?.price : null) ??
                0,
            ),
            discountRate: Number(line.discountRate ?? 0),
            taxRate: Number(result?.taxRate ?? 0),
            lineTotal: Number(result?.subtotal ?? 0),
          }),
        );
      }
      const order = manager.create(SalesOrder, {
        organizationId,
        branchId,
        orderNumber: await allocateDocumentNumber(manager, organizationId, DOCUMENT_SEQUENCE_SCOPE.SALES_ORDER, 'PED', Number(orderDate.slice(0, 4))),
        customerId: customer.id,
        quoteId,
        customerReference: input.customerReference?.trim() || null,
        orderDate,
        expectedDate: input.expectedDate ?? null,
        currencyCode,
        status: SalesOrderStatus.CONFIRMED,
        notes: input.notes?.trim() || null,
        subtotal: Number(computed.subtotal) - Number(computed.discountTotal ?? 0),
        taxTotal: Number(computed.tax ?? 0) + Number(computed.excise ?? 0),
        total: Number(computed.total),
        createdById: actorUserId,
        lines,
      });
      return manager.save(SalesOrder, order);
    });
  }

  /** An accepted quote becomes an order, once: a second conversion is refused. */
  async fromQuote(quoteId: string, organizationId: string, actorUserId: string): Promise<SalesOrder> {
    const quote = await this.dataSource.getRepository(Quote).findOne({ where: { id: quoteId, organizationId } });
    if (!quote) throw new NotFoundError('sales.orders.quote_not_found');
    if (quote.status !== QuoteStatus.ACCEPTED) throw new BadRequestError('sales.orders.quote_not_accepted');
    const existing = await this.dataSource.getRepository(SalesOrder).findOne({
      where: { organizationId, quoteId, status: In([SalesOrderStatus.CONFIRMED, SalesOrderStatus.PARTIALLY_DELIVERED, SalesOrderStatus.DELIVERED, SalesOrderStatus.CLOSED]) },
      select: ['id', 'orderNumber'],
    });
    if (existing) throw new ConflictError('sales.orders.quote_already_ordered', { orderNumber: existing.orderNumber });
    return this.create(
      {
        customerId: quote.customer.id,
        branchId: quote.branchId,
        currencyCode: quote.currencyCode,
        notes: quote.notes,
        lines: [...(quote.lines ?? [])]
          .sort((a, b) => a.lineOrder - b.lineOrder)
          .map((line) => ({
            productId: line.product?.id ?? null,
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            discountRate: Number(line.discountRate) || 0,
          })),
      },
      organizationId,
      actorUserId,
      quote.id,
    );
  }

  list(organizationId: string, filter: { status?: SalesOrderStatus; customerId?: string } = {}): Promise<SalesOrder[]> {
    return this.dataSource.getRepository(SalesOrder).find({
      where: {
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
      },
      relations: ['customer'],
      order: { orderDate: 'DESC', orderNumber: 'DESC' },
      take: 500,
    });
  }

  async get(organizationId: string, id: string): Promise<SalesOrderView> {
    const order = await this.dataSource.getRepository(SalesOrder).findOne({
      where: { id, organizationId },
      relations: ['lines', 'customer'],
    });
    if (!order) throw new NotFoundError('sales.orders.not_found');
    order.lines.sort((a, b) => a.lineOrder - b.lineOrder);
    const deliveries = await this.dataSource.getRepository(DeliveryNote).find({
      where: { organizationId, orderId: id },
      relations: ['lines'],
      order: { deliveryDate: 'ASC', number: 'ASC' },
    });
    return Object.assign(order, {
      deliveries,
      invoiceable: SalesOrdersService.invoiceable(order.lines, deliveries).map(({ line, quantity }) => ({ orderLineId: line.id, quantity })),
    });
  }

  async cancel(organizationId: string, id: string, reason: string): Promise<SalesOrder> {
    if (!reason?.trim()) throw new BadRequestError('sales.orders.cancel_reason_required');
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, organizationId, id);
      if (order.lines.some((l) => Number(l.deliveredQuantity) > EPSILON || Number(l.invoicedQuantity) > EPSILON)) {
        throw new ConflictError('sales.orders.cannot_cancel_delivered');
      }
      if (order.status === SalesOrderStatus.CANCELLED) throw new ConflictError('sales.orders.already_cancelled');
      order.status = SalesOrderStatus.CANCELLED;
      order.cancelReason = reason.trim();
      return manager.save(SalesOrder, order);
    });
  }

  /** Stop expecting the rest: what was delivered and invoiced stands, the remainder is dropped. */
  async close(organizationId: string, id: string): Promise<SalesOrder> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, organizationId, id);
      if (order.status === SalesOrderStatus.CANCELLED) throw new ConflictError('sales.orders.already_cancelled');
      const uninvoiced = await manager.count(DeliveryNote, {
        where: { organizationId, orderId: id, status: DeliveryNoteStatus.POSTED },
      });
      if (uninvoiced > 0) throw new ConflictError('sales.orders.close_with_uninvoiced_deliveries');
      order.status = SalesOrderStatus.CLOSED;
      return manager.save(SalesOrder, order);
    });
  }

  // ── Conduces ───────────────────────────────────────────────────────────────

  /** The goods leave: a conduce, the stock moved out of the order's branch, the order updated. */
  async deliver(organizationId: string, orderId: string, input: DeliverInput, actorUserId: string): Promise<DeliveryNote> {
    if (!input.lines?.length) throw new BadRequestError('sales.orders.delivery_no_lines');
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, organizationId, orderId);
      if (order.status === SalesOrderStatus.CANCELLED || order.status === SalesOrderStatus.CLOSED) {
        throw new ConflictError('sales.orders.not_open', { status: order.status });
      }
      const byId = new Map(order.lines.map((l) => [l.id, l]));
      const deliveryDate = input.deliveryDate ?? (await organizationToday(manager, organizationId));
      if (deliveryDate < order.orderDate) throw new BadRequestError('sales.orders.delivery_before_order');
      const number = await allocateDocumentNumber(manager, organizationId, DOCUMENT_SEQUENCE_SCOPE.DELIVERY_NOTE, 'CON', Number(deliveryDate.slice(0, 4)));
      const noteId = (await manager.query(`SELECT gen_random_uuid() AS id`))[0].id as string;

      const noteLines: DeliveryNoteLine[] = [];
      const seen = new Set<string>();
      for (const requested of input.lines) {
        const line = byId.get(requested.orderLineId);
        if (!line) throw new BadRequestError('sales.orders.line_not_in_order');
        if (seen.has(line.id)) throw new BadRequestError('sales.orders.line_repeated');
        seen.add(line.id);
        const quantity = Number(requested.quantity);
        if (!(quantity > 0)) throw new BadRequestError('sales.orders.quantity_positive');
        const remaining = Number(line.quantity) - Number(line.deliveredQuantity);
        if (quantity > remaining + EPSILON) {
          throw new BadRequestError('sales.orders.delivery_exceeds_remaining', { description: line.description, remaining: round6(remaining) });
        }
        if (line.isStocked && line.productId) {
          await this.inventory.decreaseStock(line.productId, quantity, manager, organizationId, {
            place: { branchId: order.branchId },
            type: 'SALE_DISPATCH',
            reference: number,
            sourceType: 'delivery_note',
            sourceId: noteId,
          });
        }
        line.deliveredQuantity = round6(Number(line.deliveredQuantity) + quantity);
        noteLines.push(manager.create(DeliveryNoteLine, { orderLineId: line.id, productId: line.productId, description: line.description, quantity }));
      }
      await manager.save(SalesOrderLine, order.lines);
      order.status = SalesOrdersService.statusOf(order.lines, order.status);
      await manager.save(SalesOrder, order);

      const customer = await manager.findOne(Customer, { where: { id: order.customerId, organizationId }, select: ['id', 'address'] });
      return manager.save(
        DeliveryNote,
        manager.create(DeliveryNote, {
          id: noteId,
          organizationId,
          branchId: order.branchId,
          number,
          orderId: order.id,
          customerId: order.customerId,
          deliveryDate,
          status: DeliveryNoteStatus.POSTED,
          driverName: input.driverName?.trim() || null,
          vehiclePlate: input.vehiclePlate?.trim().toUpperCase() || null,
          deliveryAddress: input.deliveryAddress?.trim() || (customer as { address?: string | null } | null)?.address || null,
          receivedBy: input.receivedBy?.trim() || null,
          notes: input.notes?.trim() || null,
          createdById: actorUserId,
          lines: noteLines,
        }),
      );
    });
  }

  /** Undo a conduce that was not invoiced: the goods come back and the order expects them again. */
  async voidDelivery(organizationId: string, noteId: string, reason: string): Promise<DeliveryNote> {
    if (!reason?.trim()) throw new BadRequestError('sales.orders.void_reason_required');
    return this.dataSource.transaction(async (manager) => {
      const note = await manager.findOne(DeliveryNote, { where: { id: noteId, organizationId }, relations: ['lines'] });
      if (!note) throw new NotFoundError('sales.orders.delivery_not_found');
      if (note.status !== DeliveryNoteStatus.POSTED) throw new ConflictError('sales.orders.delivery_not_voidable');
      const order = await this.lock(manager, organizationId, note.orderId);
      const byId = new Map(order.lines.map((l) => [l.id, l]));
      for (const noteLine of note.lines) {
        const line = byId.get(noteLine.orderLineId);
        if (!line) continue;
        if (line.isStocked && line.productId) {
          await this.inventory.increaseStock(line.productId, Number(noteLine.quantity), manager, organizationId, {
            place: { branchId: note.branchId },
            type: 'SALE_RETURN',
            reference: `${note.number} anulado`,
            sourceType: 'delivery_note_void',
            sourceId: note.id,
          });
        }
        line.deliveredQuantity = round6(Math.max(0, Number(line.deliveredQuantity) - Number(noteLine.quantity)));
      }
      await manager.save(SalesOrderLine, order.lines);
      order.status = SalesOrdersService.statusOf(order.lines, order.status);
      await manager.save(SalesOrder, order);
      note.status = DeliveryNoteStatus.VOIDED;
      note.voidReason = reason.trim();
      return manager.save(DeliveryNote, note);
    });
  }

  listDeliveries(organizationId: string, filter: { status?: DeliveryNoteStatus } = {}): Promise<DeliveryNote[]> {
    return this.dataSource.getRepository(DeliveryNote).find({
      where: { organizationId, ...(filter.status ? { status: filter.status } : {}) },
      relations: ['customer', 'order'],
      order: { deliveryDate: 'DESC', number: 'DESC' },
      take: 500,
    });
  }

  async getDelivery(organizationId: string, id: string): Promise<DeliveryNote> {
    const note = await this.dataSource.getRepository(DeliveryNote).findOne({
      where: { id, organizationId },
      relations: ['lines', 'customer', 'order'],
    });
    if (!note) throw new NotFoundError('sales.orders.delivery_not_found');
    return note;
  }

  // ── Invoicing ──────────────────────────────────────────────────────────────

  /**
   * Invoice what is ready to bill: the goods of the posted conduces (all of them, or those named)
   * and the ordered services not yet invoiced. Issued at once — fiscal number, ledger, e-CF —
   * WITHOUT moving stock, which left with the conduces. (A draft would be issued later through the
   * ordinary path, which moves stock, and dispatch everything a second time.)
   */
  async invoice(organizationId: string, orderId: string, actorUserId: string, deliveryNoteIds?: string[]): Promise<Invoice> {
    let issued: Invoice | null = null;
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, organizationId, orderId);
      if (order.status === SalesOrderStatus.CANCELLED) throw new ConflictError('sales.orders.already_cancelled');
      const posted = await manager.find(DeliveryNote, {
        where: {
          organizationId,
          orderId,
          status: DeliveryNoteStatus.POSTED,
          ...(deliveryNoteIds?.length ? { id: In(deliveryNoteIds) } : {}),
        },
        relations: ['lines'],
      });
      if (deliveryNoteIds?.length && posted.length !== new Set(deliveryNoteIds).size) {
        throw new BadRequestError('sales.orders.delivery_not_invoiceable');
      }
      const billable = SalesOrdersService.invoiceable(order.lines, posted);
      if (billable.length === 0) throw new BadRequestError('sales.orders.nothing_to_invoice');

      const customer = await manager.findOne(Customer, { where: { id: order.customerId, organizationId } });
      const issueDate = await organizationToday(manager, organizationId);
      const termDays = Math.max(0, Number((customer as { paymentTermDays?: number } | null)?.paymentTermDays ?? 0));
      const dueDate = new Date(Date.parse(issueDate) + termDays * 86_400_000).toISOString().slice(0, 10);
      const reference = [order.orderNumber, ...posted.map((n) => n.number), order.customerReference].filter(Boolean).join(' · ');

      issued = await this.invoices.createWithin(
        {
          customerId: order.customerId,
          branchId: order.branchId ?? undefined,
          issueDate,
          dueDate,
          currencyCode: order.currencyCode,
          notes: [reference, order.notes].filter(Boolean).join('\n'),
          issue: true,
          lineItems: billable.map(({ line, quantity }) => ({
            productId: line.productId ?? undefined,
            description: line.description,
            quantity,
            unitPrice: Number(line.unitPrice),
            discountRate: Number(line.discountRate) || undefined,
          })),
        } as CreateInvoiceDto,
        organizationId,
        manager,
        { actorUserId, moveStock: false },
      );

      for (const { line, quantity } of billable) {
        line.invoicedQuantity = round6(Number(line.invoicedQuantity) + quantity);
      }
      await manager.save(SalesOrderLine, order.lines);
      for (const note of posted) {
        note.status = DeliveryNoteStatus.INVOICED;
        note.invoiceId = (issued as Invoice).id;
      }
      if (posted.length) await manager.save(DeliveryNote, posted);
      order.status = SalesOrdersService.statusOf(order.lines, order.status);
      await manager.save(SalesOrder, order);
    });
    this.invoices.dispatchIssued(issued as unknown as Invoice);
    this.logger.log(`Pedido ${orderId}: facturado en ${(issued as unknown as Invoice).fiscalNumber ?? (issued as unknown as Invoice).invoiceNumber}`);
    return issued as unknown as Invoice;
  }

  // ── The arithmetic, apart from the database ────────────────────────────────

  /**
   * What can be invoiced now, per line: of a stocked line, what the given conduces delivered (never
   * more than is still uninvoiced); of a service or non-stocked line, all that is still uninvoiced.
   */
  static invoiceable(
    lines: SalesOrderLine[],
    postedNotes: Array<Pick<DeliveryNote, 'status'> & { lines: Array<Pick<DeliveryNoteLine, 'orderLineId' | 'quantity'>> }>,
  ): Array<{ line: SalesOrderLine; quantity: number }> {
    const delivered = new Map<string, number>();
    for (const note of postedNotes) {
      if (note.status !== DeliveryNoteStatus.POSTED) continue;
      for (const nl of note.lines) delivered.set(nl.orderLineId, (delivered.get(nl.orderLineId) ?? 0) + Number(nl.quantity));
    }
    const out: Array<{ line: SalesOrderLine; quantity: number }> = [];
    for (const line of [...lines].sort((a, b) => a.lineOrder - b.lineOrder)) {
      const uninvoiced = Number(line.quantity) - Number(line.invoicedQuantity);
      const quantity = round6(line.isStocked ? Math.min(delivered.get(line.id) ?? 0, uninvoiced) : uninvoiced);
      if (quantity > EPSILON) out.push({ line, quantity });
    }
    return out;
  }

  /** The order's state from its lines. A cancelled or closed order stays as it is. */
  static statusOf(lines: SalesOrderLine[], current: SalesOrderStatus): SalesOrderStatus {
    if (current === SalesOrderStatus.CANCELLED) return current;
    const allInvoiced = lines.every((l) => Number(l.invoicedQuantity) >= Number(l.quantity) - EPSILON);
    if (allInvoiced) return SalesOrderStatus.CLOSED;
    if (current === SalesOrderStatus.CLOSED) return current;
    const stocked = lines.filter((l) => l.isStocked);
    const allDelivered = stocked.length > 0 && stocked.every((l) => Number(l.deliveredQuantity) >= Number(l.quantity) - EPSILON);
    if (allDelivered) return SalesOrderStatus.DELIVERED;
    if (lines.some((l) => Number(l.deliveredQuantity) > EPSILON)) return SalesOrderStatus.PARTIALLY_DELIVERED;
    return SalesOrderStatus.CONFIRMED;
  }

  private async lock(manager: EntityManager, organizationId: string, id: string): Promise<SalesOrder> {
    const order = await manager
      .createQueryBuilder(SalesOrder, 'o')
      .where('o.id = :id', { id })
      .andWhere('o.organizationId = :organizationId', { organizationId })
      .setLock('pessimistic_write')
      .getOne();
    if (!order) throw new NotFoundError('sales.orders.not_found');
    order.lines = await manager.find(SalesOrderLine, { where: { orderId: order.id }, order: { lineOrder: 'ASC' } });
    return order;
  }
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
