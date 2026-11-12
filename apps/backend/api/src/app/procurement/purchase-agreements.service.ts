import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PurchaseAgreement, PurchaseAgreementLine, PurchaseAgreementStatus } from './entities/purchase-agreement.entity';
import { Supplier, SupplierStatus } from '../suppliers/entities/supplier.entity';
import { CreateAgreementDto, ReleaseAgreementDto } from './dto/purchase-agreement.dto';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../i18n/localized.exception';
import { allocateDocumentNumber, DOCUMENT_SEQUENCE_SCOPE } from '../shared/numbering/document-numbers';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { roundAmount } from '../common/money';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrder } from './entities/purchase-order.entity';

const QUANTITY_EPSILON = 0.000001;
const roundQuantity = (value: number): number => Math.round(value * 1e6) / 1e6;

/** An agreement line and what has been drawn on it. */
export interface AgreementLineUsage {
  agreementLineId: string;
  description: string;
  unitPrice: number;
  maxQuantity: number | null;
  usedQuantity: number;
  remainingQuantity: number | null;
}

export type AgreementView = PurchaseAgreement & {
  usage: AgreementLineUsage[];
  usedAmount: number;
  remainingAmount: number | null;
  releases: Array<{ id: string; number: string; status: string; total: number; orderDate: string }>;
};

/**
 * Purchase agreements — blanket orders (audit 2026-11-07, CMP-15).
 *
 * Prices agreed with one supplier for a period, with a ceiling per line and optionally overall.
 * Each release is a purchase order at those prices that goes through approval, sending and
 * receiving like any other, and cannot be edited away from them.
 *
 * What has been used is read from the release orders, never kept: an order still standing uses
 * what it orders, one closed short only what it received, a cancelled one nothing. Releases run
 * under a lock on the agreement, so two at once cannot both take its last units.
 */
@Injectable()
export class PurchaseAgreementsService {
  private readonly logger = new Logger(PurchaseAgreementsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orders: PurchaseOrdersService,
  ) {}

  list(organizationId: string): Promise<PurchaseAgreement[]> {
    return this.dataSource.manager.find(PurchaseAgreement, { where: { organizationId }, order: { createdAt: 'DESC' }, take: 200 });
  }

  findOne(id: string, organizationId: string): Promise<AgreementView> {
    return this.view(this.dataSource.manager, id, organizationId);
  }

  async create(dto: CreateAgreementDto, organizationId: string, actorUserId: string): Promise<AgreementView> {
    return this.dataSource.transaction(async (manager) => {
      const supplier = await manager.findOneBy(Supplier, { id: dto.supplierId, organizationId });
      if (!supplier) throw new BadRequestError('procurement.supplier_not_found');
      const validFrom = dto.validFrom.slice(0, 10);
      const validTo = dto.validTo.slice(0, 10);
      if (validTo < validFrom) throw new BadRequestError('procurement.agreement_validity_inverted');
      const number = await allocateDocumentNumber(manager, organizationId, DOCUMENT_SEQUENCE_SCOPE.PURCHASE_AGREEMENT, 'CTR', Number(validFrom.slice(0, 4)));
      const saved = await manager.save(
        manager.create(PurchaseAgreement, {
          organizationId,
          number,
          title: dto.title.trim(),
          supplierId: dto.supplierId,
          status: PurchaseAgreementStatus.DRAFT,
          validFrom,
          validTo,
          currencyCode: (dto.currencyCode ?? (await this.baseCurrency(manager, organizationId))).toUpperCase(),
          maxAmount: dto.maxAmount ?? null,
          notes: dto.notes ?? null,
          createdByUserId: actorUserId,
          lines: dto.lines.map((line, index) =>
            manager.create(PurchaseAgreementLine, {
              organizationId,
              productId: line.productId ?? null,
              description: line.description.trim(),
              unitPrice: line.unitPrice,
              taxRate: line.taxRate ?? 0,
              maxQuantity: line.maxQuantity ?? null,
              unitOfMeasure: line.unitOfMeasure ?? 'UND',
              sortOrder: index,
            }),
          ),
        }),
      );
      return this.view(manager, saved.id, organizationId);
    });
  }

  /**
   * Put it in force. Committing the company to prices for a period is an approval: not by whoever
   * wrote it, while the company has someone else who could (the purchase order's own rule).
   */
  async activate(id: string, organizationId: string, actorUserId: string): Promise<AgreementView> {
    return this.dataSource.transaction(async (manager) => {
      const agreement = await this.lock(manager, id, organizationId);
      if (agreement.status !== PurchaseAgreementStatus.DRAFT) {
        throw new ConflictError('procurement.agreement_not_draft', { number: agreement.number, status: agreement.status });
      }
      if (agreement.createdByUserId && agreement.createdByUserId === actorUserId) {
        const [others] = await manager.query(
          'SELECT COUNT(*)::int AS count FROM user_organizations WHERE organization_id = $1 AND user_id <> $2',
          [organizationId, actorUserId],
        );
        if (Number(others?.count ?? 0) > 0) throw new ForbiddenError('procurement.cannot_activate_own_agreement');
      }
      await manager.update(PurchaseAgreement, { id, organizationId }, {
        status: PurchaseAgreementStatus.ACTIVE,
        activatedByUserId: actorUserId,
        activatedAt: new Date(),
      });
      return this.view(manager, id, organizationId);
    });
  }

  /** End it early. What was released stands; nothing more can be. A draft is cancelled instead. */
  async close(id: string, organizationId: string, reason: string): Promise<AgreementView> {
    return this.dataSource.transaction(async (manager) => {
      const agreement = await this.lock(manager, id, organizationId);
      const to =
        agreement.status === PurchaseAgreementStatus.DRAFT
          ? PurchaseAgreementStatus.CANCELLED
          : agreement.status === PurchaseAgreementStatus.ACTIVE
            ? PurchaseAgreementStatus.CLOSED
            : null;
      if (!to) throw new ConflictError('procurement.agreement_not_open', { number: agreement.number, status: agreement.status });
      await manager.update(PurchaseAgreement, { id, organizationId }, { status: to, closedAt: new Date(), closeReason: reason.trim() });
      return this.view(manager, id, organizationId);
    });
  }

  /**
   * Release an order against the agreement: a draft purchase order at the agreed prices, each line
   * bound to its agreement line. Refused outside the validity, from a blocked supplier, or beyond
   * a ceiling — counted against every release still standing.
   */
  async release(id: string, dto: ReleaseAgreementDto, organizationId: string, actorUserId: string): Promise<PurchaseOrder> {
    return this.dataSource.transaction(async (manager) => {
      const agreement = await this.lock(manager, id, organizationId);
      if (agreement.status !== PurchaseAgreementStatus.ACTIVE) {
        throw new ConflictError('procurement.agreement_not_active', { number: agreement.number, status: agreement.status });
      }
      const today = await organizationToday(manager, organizationId);
      if (today < agreement.validFrom || today > agreement.validTo) {
        throw new BadRequestError('procurement.agreement_outside_validity', { from: agreement.validFrom, to: agreement.validTo, date: today });
      }
      const supplier = await manager.findOneBy(Supplier, { id: agreement.supplierId, organizationId });
      if (!supplier || supplier.status === SupplierStatus.BLOCKED) throw new BadRequestError('procurement.agreement_supplier_blocked');

      const lines = new Map(agreement.lines.map((line) => [line.id, line]));
      const usage = new Map((await this.usage(manager, agreement)).map((u) => [u.agreementLineId, u]));
      const requested = new Map<string, number>();
      for (const line of dto.lines) {
        if (!lines.has(line.agreementLineId)) throw new BadRequestError('procurement.agreement_line_not_found', { id: line.agreementLineId });
        requested.set(line.agreementLineId, roundQuantity((requested.get(line.agreementLineId) ?? 0) + line.quantity));
      }
      let releaseAmount = 0;
      for (const [lineId, quantity] of requested) {
        const line = lines.get(lineId)!;
        const used = usage.get(lineId)?.usedQuantity ?? 0;
        if (line.maxQuantity !== null && used + quantity - Number(line.maxQuantity) > QUANTITY_EPSILON) {
          throw new BadRequestError('procurement.agreement_line_exhausted', {
            description: line.description,
            remaining: roundQuantity(Number(line.maxQuantity) - used),
            requested: quantity,
          });
        }
        releaseAmount = roundAmount(releaseAmount + roundAmount(quantity * Number(line.unitPrice)));
      }
      if (agreement.maxAmount !== null) {
        const usedAmount = await this.usedAmount(manager, agreement);
        if (roundAmount(usedAmount + releaseAmount) > Number(agreement.maxAmount)) {
          throw new BadRequestError('procurement.agreement_amount_exhausted', {
            remaining: roundAmount(Number(agreement.maxAmount) - usedAmount),
            requested: releaseAmount,
          });
        }
      }

      const ordered = [...requested.entries()].sort((a, b) => lines.get(a[0])!.sortOrder - lines.get(b[0])!.sortOrder);
      const order = await this.orders.createIn(
        manager,
        {
          supplierId: agreement.supplierId,
          branchId: dto.branchId,
          currencyCode: agreement.currencyCode,
          expectedDate: dto.expectedDate,
          notes: dto.notes ?? `${agreement.number} · ${agreement.title}`,
          lines: ordered.map(([lineId, quantity]) => {
            const line = lines.get(lineId)!;
            return {
              productId: line.productId ?? undefined,
              description: line.description,
              quantity,
              unitPrice: Number(line.unitPrice),
              taxRate: Number(line.taxRate),
              unitOfMeasure: line.unitOfMeasure,
            };
          }),
        },
        organizationId,
        actorUserId,
        { agreementId: agreement.id, lineLinks: ordered.map(([lineId]) => lineId) },
      );
      this.logger.log(`Entrega ${order.number} contra el acuerdo ${agreement.number}.`);
      return order;
    });
  }

  /**
   * What each line has used: a release still standing counts what it orders; one closed short,
   * what was received; a cancelled one, nothing.
   */
  private async usage(manager: EntityManager, agreement: PurchaseAgreement): Promise<AgreementLineUsage[]> {
    const rows: Array<{ agreement_line_id: string; used: string }> = await manager.query(
      `SELECT l."agreement_line_id",
              COALESCE(SUM(CASE WHEN o."status" = 'CLOSED' THEN l."received_quantity" ELSE l."quantity" END), 0) AS used
         FROM "purchase_order_lines" l
         JOIN "purchase_orders" o ON o."id" = l."order_id"
        WHERE o."agreement_id" = $1 AND o."organization_id" = $2 AND o."status" <> 'CANCELLED'
        GROUP BY l."agreement_line_id"`,
      [agreement.id, agreement.organizationId],
    );
    const used = new Map(rows.map((row) => [row.agreement_line_id, Number(row.used)]));
    return [...agreement.lines]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => {
        const usedQuantity = roundQuantity(used.get(line.id) ?? 0);
        return {
          agreementLineId: line.id,
          description: line.description,
          unitPrice: Number(line.unitPrice),
          maxQuantity: line.maxQuantity === null ? null : Number(line.maxQuantity),
          usedQuantity,
          remainingQuantity: line.maxQuantity === null ? null : roundQuantity(Math.max(0, Number(line.maxQuantity) - usedQuantity)),
        };
      });
  }

  /** Amount used before tax, on the same terms as `usage`. */
  private async usedAmount(manager: EntityManager, agreement: PurchaseAgreement): Promise<number> {
    const [row] = await manager.query(
      `SELECT COALESCE(SUM(ROUND(CASE WHEN o."status" = 'CLOSED' THEN l."received_quantity" ELSE l."quantity" END * l."unit_price", 2)), 0) AS used
         FROM "purchase_order_lines" l
         JOIN "purchase_orders" o ON o."id" = l."order_id"
        WHERE o."agreement_id" = $1 AND o."organization_id" = $2 AND o."status" <> 'CANCELLED'`,
      [agreement.id, agreement.organizationId],
    );
    return roundAmount(Number(row?.used ?? 0));
  }

  private async view(manager: EntityManager, id: string, organizationId: string): Promise<AgreementView> {
    const agreement = await this.load(manager, id, organizationId);
    const usedAmount = await this.usedAmount(manager, agreement);
    const releases: Array<{ id: string; number: string; status: string; total: string; order_date: string }> = await manager.query(
      `SELECT "id", "number", "status", "total", "order_date" FROM "purchase_orders"
        WHERE "agreement_id" = $1 AND "organization_id" = $2 ORDER BY "created_at"`,
      [id, organizationId],
    );
    return Object.assign(agreement, {
      usage: await this.usage(manager, agreement),
      usedAmount,
      remainingAmount: agreement.maxAmount === null ? null : roundAmount(Math.max(0, Number(agreement.maxAmount) - usedAmount)),
      releases: releases.map((r) => ({ id: r.id, number: r.number, status: r.status, total: Number(r.total), orderDate: String(r.order_date).slice(0, 10) })),
    });
  }

  private async lock(manager: EntityManager, id: string, organizationId: string): Promise<PurchaseAgreement> {
    await manager.query(`SELECT "id" FROM "purchase_agreements" WHERE "id" = $1 AND "organization_id" = $2 FOR UPDATE`, [id, organizationId]);
    return this.load(manager, id, organizationId);
  }

  private async load(manager: EntityManager, id: string, organizationId: string): Promise<PurchaseAgreement> {
    const agreement = await manager.findOne(PurchaseAgreement, {
      where: { id, organizationId },
      relations: ['lines'],
      order: { lines: { sortOrder: 'ASC' } },
    });
    if (!agreement) throw new NotFoundError('procurement.agreement_not_found', { id });
    return agreement;
  }

  private async baseCurrency(manager: EntityManager, organizationId: string): Promise<string> {
    // Read by SQL: the settings entity belongs to identity (verify:boundaries).
    const [row] = await manager.query(`SELECT "base_currency" FROM "organization_settings" WHERE "organization_id" = $1`, [organizationId]);
    return row?.base_currency ?? 'USD';
  }
}
