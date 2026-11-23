import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { PurchaseRfq, PurchaseRfqLine, PurchaseRfqSupplier, RfqStatus } from './entities/purchase-rfq.entity';
import { SupplierQuote, SupplierQuoteLine, SupplierQuoteStatus } from './entities/supplier-quote.entity';
import { PurchaseRequisition, PurchaseRequisitionStatus } from './entities/purchase-requisition.entity';
import { Supplier, SupplierStatus } from '../suppliers/entities/supplier.entity';
import { AwardQuoteDto, CreateRfqDto, RecordQuoteDto } from './dto/rfq.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { allocateDocumentNumber, DOCUMENT_SEQUENCE_SCOPE } from '../shared/numbering/document-numbers';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { roundAmount } from '../common/money';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ProcurementService } from './procurement.service';
import { PurchaseOrder } from './entities/purchase-order.entity';

/** How a quotation stands against its RFQ on a given day, for the comparison and the award. */
export interface QuoteStanding {
  quoteId: string;
  supplierId: string;
  supplierName: string | null;
  total: number;
  subtotal: number;
  validUntil: string;
  leadTimeDays: number | null;
  status: SupplierQuoteStatus;
  /** Quotes every line of the RFQ. */
  complete: boolean;
  /** Still holds today. */
  current: boolean;
  /** The supplier is not blocked. */
  supplierActive: boolean;
  /** Complete, current and from an active supplier: it can be awarded. */
  eligible: boolean;
  /**
   * The lowest NET amount among the eligible ones. Net, not total: input tax is recovered, and a
   * supplier that leaves the tax off a quotation would otherwise rank cheaper for it.
   */
  cheapest: boolean;
}

export interface RfqComparison {
  rfqId: string;
  currencyCode: string;
  asOf: string;
  quotes: QuoteStanding[];
  lines: Array<{
    rfqLineId: string;
    description: string;
    quantity: number;
    offers: Array<{ quoteId: string; supplierId: string; unitPrice: number; amount: number; lowest: boolean }>;
  }>;
}

/**
 * Requests for quotation and the quotations that answer them (audit 2026-11-07, CMP-15).
 *
 * The order used to carry whatever price the buyer typed, with nothing to show it was compared.
 * An RFQ asks the invited suppliers for the same lines; each answer is recorded per line and
 * totalled here; the comparison ranks them; the award turns one into a draft purchase order at its
 * prices, which then goes through the order's own approval. Choosing a quotation that is not the
 * cheapest eligible one is allowed — price is not the only criterion — but takes a written reason,
 * kept on the RFQ.
 */
@Injectable()
export class RfqsService {
  private readonly logger = new Logger(RfqsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orders: PurchaseOrdersService,
    private readonly requisitions: ProcurementService,
  ) {}

  list(organizationId: string, status?: RfqStatus): Promise<PurchaseRfq[]> {
    return this.dataSource.manager.find(PurchaseRfq, {
      where: { organizationId, ...(status ? { status } : {}) },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async findOne(id: string, organizationId: string): Promise<PurchaseRfq & { quotes: SupplierQuote[] }> {
    return this.load(this.dataSource.manager, id, organizationId);
  }

  async create(dto: CreateRfqDto, organizationId: string, actorUserId: string): Promise<PurchaseRfq> {
    return this.dataSource.transaction(async (manager) => {
      let lines = dto.lines ?? [];
      if (dto.requisitionId) {
        const requisition = await manager.findOne(PurchaseRequisition, {
          where: { id: dto.requisitionId, organizationId },
          relations: ['lines'],
        });
        if (!requisition) throw new NotFoundError('procurement.requisition_not_found', { id: dto.requisitionId });
        // Only an approved need is sourced: an RFQ is the first step of spending it.
        if (requisition.status !== PurchaseRequisitionStatus.APPROVED) {
          throw new BadRequestError('procurement.rfq_requisition_not_approved', { status: requisition.status });
        }
        if (lines.length === 0) {
          lines = [...(requisition.lines ?? [])]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((line) => ({
              productId: line.productId ?? undefined,
              description: line.description,
              quantity: Number(line.quantity),
              unitOfMeasure: line.unitOfMeasure,
            }));
        }
      }
      if (lines.length === 0) throw new BadRequestError('procurement.rfq_needs_lines');
      const supplierIds = [...new Set(dto.supplierIds)];
      await this.assertSuppliers(manager, organizationId, supplierIds);

      const today = await organizationToday(manager, organizationId);
      const number = await allocateDocumentNumber(manager, organizationId, DOCUMENT_SEQUENCE_SCOPE.PURCHASE_RFQ, 'RFQ', Number(today.slice(0, 4)));
      const rfq = await manager.save(
        manager.create(PurchaseRfq, {
          organizationId,
          number,
          title: dto.title.trim(),
          status: RfqStatus.DRAFT,
          requisitionId: dto.requisitionId ?? null,
          currencyCode: (dto.currencyCode ?? (await this.baseCurrency(manager, organizationId))).toUpperCase(),
          responseDueDate: dto.responseDueDate ? dto.responseDueDate.slice(0, 10) : null,
          notes: dto.notes ?? null,
          createdByUserId: actorUserId,
          lines: lines.map((line, index) =>
            manager.create(PurchaseRfqLine, {
              organizationId,
              productId: line.productId ?? null,
              description: line.description.trim(),
              quantity: line.quantity,
              unitOfMeasure: line.unitOfMeasure ?? 'UND',
              sortOrder: index,
            }),
          ),
          suppliers: supplierIds.map((supplierId) => manager.create(PurchaseRfqSupplier, { organizationId, supplierId })),
        }),
      );
      return this.load(manager, rfq.id, organizationId);
    });
  }

  /** Sent to the suppliers: from here its lines are fixed and quotations can be recorded. */
  async send(id: string, organizationId: string): Promise<PurchaseRfq> {
    return this.dataSource.transaction(async (manager) => {
      const rfq = await this.lockAndLoad(manager, id, organizationId);
      if (rfq.status !== RfqStatus.DRAFT) throw new ConflictError('procurement.rfq_not_draft', { number: rfq.number });
      if (!rfq.suppliers?.length) throw new BadRequestError('procurement.rfq_needs_suppliers');
      await manager.update(PurchaseRfq, { id, organizationId }, { status: RfqStatus.SENT, sentAt: new Date() });
      return this.load(manager, id, organizationId);
    });
  }

  async cancel(id: string, organizationId: string, reason: string): Promise<PurchaseRfq> {
    return this.dataSource.transaction(async (manager) => {
      const rfq = await this.lockAndLoad(manager, id, organizationId);
      if (rfq.status === RfqStatus.AWARDED || rfq.status === RfqStatus.CANCELLED) {
        throw new ConflictError('procurement.rfq_closed', { number: rfq.number, status: rfq.status });
      }
      await manager.update(PurchaseRfq, { id, organizationId }, { status: RfqStatus.CANCELLED, cancellationReason: reason.trim() });
      return this.load(manager, id, organizationId);
    });
  }

  /**
   * Record a supplier's quotation. Only an invited supplier, only while the RFQ is out, only lines
   * of this RFQ, each at most once. Recording it again replaces the previous one: a supplier
   * revises its offer, it does not make two.
   */
  async recordQuote(rfqId: string, dto: RecordQuoteDto, organizationId: string): Promise<SupplierQuote> {
    return this.dataSource.transaction(async (manager) => {
      const rfq = await this.lockAndLoad(manager, rfqId, organizationId);
      if (rfq.status !== RfqStatus.SENT) throw new ConflictError('procurement.rfq_not_open_for_quotes', { number: rfq.number, status: rfq.status });
      if (!rfq.suppliers.some((invite) => invite.supplierId === dto.supplierId)) {
        throw new BadRequestError('procurement.quote_supplier_not_invited');
      }
      const rfqLines = new Map(rfq.lines.map((line) => [line.id, line]));
      const seen = new Set<string>();
      for (const line of dto.lines) {
        if (!rfqLines.has(line.rfqLineId)) throw new BadRequestError('procurement.quote_line_not_in_rfq', { id: line.rfqLineId });
        if (seen.has(line.rfqLineId)) throw new BadRequestError('procurement.quote_line_repeated', { id: line.rfqLineId });
        seen.add(line.rfqLineId);
      }
      const receivedOn = dto.receivedOn ? dto.receivedOn.slice(0, 10) : await organizationToday(manager, organizationId);
      const validUntil = dto.validUntil.slice(0, 10);
      if (validUntil < receivedOn) throw new BadRequestError('procurement.quote_validity_before_receipt');

      // Totals from the lines, at the RFQ's quantities: never a figure the request states.
      let subtotal = 0;
      let taxTotal = 0;
      for (const line of dto.lines) {
        const amount = roundAmount(Number(rfqLines.get(line.rfqLineId)!.quantity) * line.unitPrice);
        subtotal = roundAmount(subtotal + amount);
        taxTotal = roundAmount(taxTotal + roundAmount(amount * (line.taxRate ?? 0)));
      }

      await manager.delete(SupplierQuote, { organizationId, rfqId, supplierId: dto.supplierId });
      const quote = await manager.save(
        manager.create(SupplierQuote, {
          organizationId,
          rfqId,
          supplierId: dto.supplierId,
          reference: dto.reference?.trim() || null,
          receivedOn,
          validUntil,
          leadTimeDays: dto.leadTimeDays ?? null,
          status: SupplierQuoteStatus.RECEIVED,
          subtotal,
          taxTotal,
          total: roundAmount(subtotal + taxTotal),
          notes: dto.notes ?? null,
          lines: dto.lines.map((line) =>
            manager.create(SupplierQuoteLine, { organizationId, rfqLineId: line.rfqLineId, unitPrice: line.unitPrice, taxRate: line.taxRate ?? 0 }),
          ),
        }),
      );
      return manager.findOneOrFail(SupplierQuote, { where: { id: quote.id }, relations: ['lines'] });
    });
  }

  /** The quotations side by side, ranked, as they stand today. */
  async comparison(rfqId: string, organizationId: string): Promise<RfqComparison> {
    const manager = this.dataSource.manager;
    const rfq = await this.load(manager, rfqId, organizationId);
    return this.compare(manager, rfq, await organizationToday(manager, organizationId));
  }

  /**
   * Award a quotation: a draft purchase order to its supplier at its prices, the RFQ closed as
   * awarded, the other quotations declined, and the requisition (if any) marked as ordered. All
   * of it in one transaction, under the RFQ's lock, so it is awarded once.
   */
  async award(rfqId: string, dto: AwardQuoteDto, organizationId: string, actorUserId: string): Promise<PurchaseOrder> {
    return this.dataSource.transaction(async (manager) => {
      const rfq = await this.lockAndLoad(manager, rfqId, organizationId);
      if (rfq.status !== RfqStatus.SENT) throw new ConflictError('procurement.rfq_not_open_for_quotes', { number: rfq.number, status: rfq.status });
      const today = await organizationToday(manager, organizationId);
      const comparison = await this.compare(manager, rfq, today);
      const standing = comparison.quotes.find((q) => q.quoteId === dto.quoteId);
      if (!standing) throw new NotFoundError('procurement.quote_not_found', { id: dto.quoteId });
      if (!standing.complete) throw new BadRequestError('procurement.quote_incomplete');
      if (!standing.current) throw new BadRequestError('procurement.quote_expired', { validUntil: standing.validUntil });
      if (!standing.supplierActive) throw new BadRequestError('procurement.quote_supplier_blocked');
      const reason = dto.reason?.trim() ?? '';
      if (!standing.cheapest && reason.length < 3) {
        throw new BadRequestError('procurement.award_not_cheapest_needs_reason', {
          awarded: standing.subtotal,
          cheapest: Math.min(...comparison.quotes.filter((q) => q.eligible).map((q) => q.subtotal)),
        });
      }

      const quote = rfq.quotes.find((q) => q.id === dto.quoteId)!;
      const priceOf = new Map(quote.lines.map((line) => [line.rfqLineId, line]));
      const order = await this.orders.createIn(
        manager,
        {
          supplierId: quote.supplierId,
          branchId: dto.branchId,
          currencyCode: rfq.currencyCode,
          expectedDate: dto.expectedDate,
          notes: `${rfq.number} · ${rfq.title}`,
          lines: [...rfq.lines]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((line) => ({
              productId: line.productId ?? undefined,
              description: line.description,
              quantity: Number(line.quantity),
              unitPrice: Number(priceOf.get(line.id)!.unitPrice),
              taxRate: Number(priceOf.get(line.id)!.taxRate),
              unitOfMeasure: line.unitOfMeasure,
            })),
        },
        organizationId,
        actorUserId,
        { rfqId: rfq.id, supplierQuoteId: quote.id, requisitionId: rfq.requisitionId },
      );

      await manager.update(SupplierQuote, { organizationId, rfqId: rfq.id }, { status: SupplierQuoteStatus.DECLINED });
      await manager.update(SupplierQuote, { id: quote.id, organizationId }, { status: SupplierQuoteStatus.AWARDED });
      await manager.update(PurchaseRfq, { id: rfq.id, organizationId }, {
        status: RfqStatus.AWARDED,
        awardedQuoteId: quote.id,
        awardedOrderId: order.id,
        awardedByUserId: actorUserId,
        awardedAt: new Date(),
        awardReason: reason || null,
      });
      if (rfq.requisitionId) await this.requisitions.markConverted(manager, rfq.requisitionId, organizationId, order.id);
      this.logger.log(`${rfq.number} adjudicada a ${quote.supplierId}: orden ${order.number}.`);
      return order;
    });
  }

  private async compare(manager: EntityManager, rfq: PurchaseRfq & { quotes: SupplierQuote[] }, today: string): Promise<RfqComparison> {
    const supplierIds = [...new Set(rfq.quotes.map((q) => q.supplierId))];
    const suppliers = supplierIds.length
      ? await manager.find(Supplier, { where: { id: In(supplierIds), organizationId: rfq.organizationId }, select: ['id', 'name', 'status'] })
      : [];
    const supplierOf = new Map(suppliers.map((s) => [s.id, s]));
    const lineIds = rfq.lines.map((line) => line.id);
    const quotes: QuoteStanding[] = rfq.quotes.map((quote) => {
      const quoted = new Set(quote.lines.map((line) => line.rfqLineId));
      const complete = lineIds.every((id) => quoted.has(id));
      const current = quote.validUntil >= today;
      const supplierActive = supplierOf.get(quote.supplierId)?.status !== SupplierStatus.BLOCKED;
      return {
        quoteId: quote.id,
        supplierId: quote.supplierId,
        supplierName: (supplierOf.get(quote.supplierId) as { name?: string } | undefined)?.name ?? null,
        total: Number(quote.total),
        subtotal: Number(quote.subtotal),
        validUntil: quote.validUntil,
        leadTimeDays: quote.leadTimeDays,
        status: quote.status,
        complete,
        current,
        supplierActive,
        eligible: complete && current && supplierActive && quote.status === SupplierQuoteStatus.RECEIVED,
        cheapest: false,
      };
    });
    const eligible = quotes.filter((q) => q.eligible);
    const lowest = eligible.length ? Math.min(...eligible.map((q) => q.subtotal)) : null;
    for (const q of quotes) q.cheapest = q.eligible && lowest !== null && q.subtotal === lowest;

    const lines = [...rfq.lines]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => {
        const offers = rfq.quotes.flatMap((quote) => {
          const priced = quote.lines.find((l) => l.rfqLineId === line.id);
          return priced
            ? [{ quoteId: quote.id, supplierId: quote.supplierId, unitPrice: Number(priced.unitPrice), amount: roundAmount(Number(line.quantity) * Number(priced.unitPrice)), lowest: false }]
            : [];
        });
        const min = offers.length ? Math.min(...offers.map((o) => o.unitPrice)) : null;
        for (const offer of offers) offer.lowest = offer.unitPrice === min;
        return { rfqLineId: line.id, description: line.description, quantity: Number(line.quantity), offers };
      });
    return { rfqId: rfq.id, currencyCode: rfq.currencyCode, asOf: today, quotes, lines };
  }

  private async assertSuppliers(manager: EntityManager, organizationId: string, supplierIds: string[]): Promise<void> {
    if (supplierIds.length === 0) return;
    const found = await manager.find(Supplier, { where: { id: In(supplierIds), organizationId }, select: ['id', 'status'] });
    if (found.length !== supplierIds.length) throw new BadRequestError('procurement.supplier_not_found');
    if (found.some((s) => s.status === SupplierStatus.BLOCKED)) throw new BadRequestError('procurement.quote_supplier_blocked');
  }

  private async lockAndLoad(manager: EntityManager, id: string, organizationId: string) {
    await manager.query(`SELECT "id" FROM "purchase_rfqs" WHERE "id" = $1 AND "organization_id" = $2 FOR UPDATE`, [id, organizationId]);
    return this.load(manager, id, organizationId);
  }

  private async load(manager: EntityManager, id: string, organizationId: string): Promise<PurchaseRfq & { quotes: SupplierQuote[] }> {
    const rfq = await manager.findOne(PurchaseRfq, {
      where: { id, organizationId },
      relations: ['lines', 'suppliers'],
      order: { lines: { sortOrder: 'ASC' } },
    });
    if (!rfq) throw new NotFoundError('procurement.rfq_not_found', { id });
    const quotes = await manager.find(SupplierQuote, { where: { rfqId: id, organizationId }, relations: ['lines'], order: { subtotal: 'ASC' } });
    return Object.assign(rfq, { quotes });
  }

  private async baseCurrency(manager: EntityManager, organizationId: string): Promise<string> {
    // Read by SQL: the settings entity belongs to identity (verify:boundaries).
    const [row] = await manager.query(`SELECT "base_currency" FROM "organization_settings" WHERE "organization_id" = $1`, [organizationId]);
    return row?.base_currency ?? 'USD';
  }
}
