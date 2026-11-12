import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { roundAmount } from '../common/money';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { GoodsReceiptPort } from '../inventory/contracts/goods-receipt.contract';
import { LedgerPostingRegistry } from '../contracts/ledger-posting/ledger-posting.contract';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { PurchaseOrderReceipt } from './entities/purchase-order-receipt.entity';
import {
  LandedCostAllocation,
  LandedCostAllocationLine,
  LandedCostAllocationStatus,
} from './entities/landed-cost-allocation.entity';
import { ApplyLandedCostDto } from './dto/landed-cost-allocation.dto';

type Method = 'VALUE' | 'QUANTITY' | 'WEIGHT' | 'VOLUME';

/**
 * Landed costs applied to received goods (audit 2026-11-07, CMP-21). See {@link LandedCostAllocation}.
 *
 * The cost is split over the receipts' stocked lines by the catalogue's method — value (quantity ×
 * unit cost), quantity, or weight/volume per unit from the product's `weight`/`volume` attribute —
 * with the cents allocated by largest remainder so the shares add up to the amount exactly. Each
 * share goes through the same port the AP price-difference path uses: the units still on hand
 * take it into their weighted-average cost, the rest is cost of sales. Verificar con contador
 * local el tratamiento de derechos aduaneros recuperables.
 */
@Injectable()
export class LandedCostsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inventory: GoodsReceiptPort,
    private readonly ledger: LedgerPostingRegistry,
  ) {}



  list(organizationId: string): Promise<LandedCostAllocation[]> {
    return this.dataSource.getRepository(LandedCostAllocation).find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async apply(dto: ApplyLandedCostDto, organizationId: string, actorUserId: string | null): Promise<LandedCostAllocation> {
    return this.dataSource.transaction(async (manager) => {
      const [catalogue] = await manager.query(
        `SELECT "id", "name", "allocationMethod" AS method, "gl_account_id" AS account, "isActive" AS active
           FROM "landed_costs" WHERE "id" = $1 AND "organization_id" = $2`,
        [dto.landedCostId, organizationId],
      );
      if (!catalogue) throw new NotFoundError('procurement.landed_cost.type_not_found');
      if (!catalogue.active) throw new ConflictError('procurement.landed_cost.type_inactive', { name: catalogue.name });
      if (!catalogue.account) throw new BadRequestError('procurement.landed_cost.type_has_no_account', { name: catalogue.name });

      const receiptIds = [...new Set(dto.receiptIds)];
      const receipts = await manager.find(PurchaseOrderReceipt, { where: { id: In(receiptIds), organizationId } });
      if (receipts.length !== receiptIds.length) throw new NotFoundError('procurement.landed_cost.receipt_not_found');

      const candidates = receipts.flatMap((receipt) =>
        (receipt.lines ?? [])
          .filter((line) => line.stocked && line.productId && Number(line.quantity) > 0)
          .map((line) => ({ receiptId: receipt.id, productId: line.productId as string, description: line.description, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
      );
      if (candidates.length === 0) throw new BadRequestError('procurement.landed_cost.no_stocked_lines');

      const method = String(catalogue.method).toUpperCase() as Method;
      const weights = await this.weightsFor(manager, organizationId, method, candidates);
      const shares = allocate(roundAmount(dto.amount), weights);

      const [settings] = await manager.query(
        `SELECT "default_inventory_id" AS inventory, "default_cost_of_goods_sold_id" AS cogs FROM "organization_settings" WHERE "organization_id" = $1`,
        [organizationId],
      );
      if (!settings?.inventory) throw new BadRequestError('procurement.landed_cost.inventory_account_not_configured');

      const lines: LandedCostAllocationLine[] = [];
      for (const [i, candidate] of candidates.entries()) {
        const share = shares[i];
        if (share === 0) continue;
        const { absorbed, units } = await this.inventory.absorbReceivedCostDifference(manager, organizationId, {
          productId: candidate.productId,
          quantity: candidate.quantity,
          amount: share,
        });
        lines.push({ ...pick(candidate), share, absorbed, units, toCostOfSales: roundAmount(share - absorbed) });
      }
      const toInventory = roundAmount(lines.reduce((sum, line) => sum + line.absorbed, 0));
      const toCostOfSales = roundAmount(dto.amount - toInventory);
      if (toCostOfSales !== 0 && !settings.cogs) {
        throw new BadRequestError('procurement.landed_cost.cost_of_sales_account_not_configured');
      }

      const date = dto.date?.slice(0, 10) ?? (await organizationToday(manager, organizationId));
      const label = `${catalogue.name}${dto.reference ? ` · ${dto.reference}` : ''}`;
      const row = (accountId: string, debit: number, credit: number) => ({ accountId, debit, credit, description: label });
      const entry = await this.ledger.post(
        manager,
        organizationId,
        {
          journalCode: 'COMPRAS',
          date,
          description: label,
          lines: [
            ...(toInventory !== 0 ? [row(settings.inventory, toInventory, 0)] : []),
            ...(toCostOfSales !== 0 ? [row(settings.cogs, toCostOfSales, 0)] : []),
            row(catalogue.account, 0, roundAmount(dto.amount)),
          ],
        },
        { actorUserId, systemReason: 'landed-cost', module: 'inventory' },
      );

      return manager.save(
        manager.create(LandedCostAllocation, {
          organizationId,
          landedCostId: catalogue.id,
          date,
          amount: roundAmount(dto.amount).toFixed(2),
          allocationMethod: method,
          receiptIds,
          reference: dto.reference?.trim() || null,
          lines,
          status: LandedCostAllocationStatus.POSTED,
          journalEntryId: entry.id,
          createdByUserId: actorUserId,
        }),
      );
    });
  }

  /**
   * Give a landed cost back: each line returns what it absorbed — in full only while the units
   * that carried it are still on hand — the remainder goes to the cost of sales, and the entry is
   * reversed.
   */
  async void(id: string, reason: string, organizationId: string, actorUserId: string | null): Promise<LandedCostAllocation> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT 1 FROM "landed_cost_allocations" WHERE "id" = $1 AND "organization_id" = $2 FOR UPDATE`, [id, organizationId]);
      const doc = await manager.findOne(LandedCostAllocation, { where: { id, organizationId } });
      if (!doc) throw new NotFoundError('procurement.landed_cost.not_found');
      if (doc.status === LandedCostAllocationStatus.VOID) throw new ConflictError('procurement.landed_cost.already_void');

      let notReturned = 0;
      for (const line of doc.lines) {
        if (line.absorbed === 0) continue;
        const back = await this.inventory.absorbReceivedCostDifference(manager, organizationId, {
          productId: line.productId,
          quantity: line.units,
          amount: -line.absorbed,
        });
        notReturned = roundAmount(notReturned + (line.absorbed + back.absorbed));
      }
      const date = await organizationToday(manager, organizationId);
      if (doc.journalEntryId) {
        await this.ledger.reverse(manager, organizationId, doc.journalEntryId, { date, reason }, {
          actorUserId,
          systemReason: 'landed-cost-void',
          module: 'inventory',
        });
      }
      // What could not leave the average cost (the units were sold meanwhile) moves from inventory
      // to the cost of sales, so the inventory account keeps matching the kardex.
      if (notReturned !== 0) {
        const [settings] = await manager.query(
          `SELECT "default_inventory_id" AS inventory, "default_cost_of_goods_sold_id" AS cogs FROM "organization_settings" WHERE "organization_id" = $1`,
          [organizationId],
        );
        const amount = Math.abs(notReturned);
        const row = (accountId: string, debit: number, credit: number) => ({ accountId, debit, credit, description: reason });
        await this.ledger.post(
          manager,
          organizationId,
          {
            journalCode: 'COMPRAS',
            date,
            description: reason,
            lines: notReturned > 0 ? [row(settings.inventory, amount, 0), row(settings.cogs, 0, amount)] : [row(settings.cogs, amount, 0), row(settings.inventory, 0, amount)],
          },
          { actorUserId, systemReason: 'landed-cost-void', module: 'inventory' },
        );
      }
      doc.status = LandedCostAllocationStatus.VOID;
      // The gateway reverses without returning the reversal's id; the original entry records it.
      return manager.save(doc);
    });
  }

  private async weightsFor(
    manager: EntityManager,
    organizationId: string,
    method: Method,
    lines: Array<{ productId: string; quantity: number; unitCost: number; description: string }>,
  ): Promise<number[]> {
    if (method === 'VALUE') return lines.map((line) => line.quantity * line.unitCost);
    if (method === 'QUANTITY') return lines.map((line) => line.quantity);
    const attribute = method === 'WEIGHT' ? 'weight' : 'volume';
    const products: Array<{ id: string; value: string | null; name: string }> = await manager.query(
      `SELECT "id", "attributes" ->> $3 AS value, "name" FROM "products" WHERE "id" = ANY($1::uuid[]) AND "organization_id" = $2`,
      [[...new Set(lines.map((line) => line.productId))], organizationId, attribute],
    );
    return lines.map((line) => {
      const product = products.find((p) => p.id === line.productId);
      const perUnit = Number(String(product?.value ?? '').replace(',', '.'));
      if (!Number.isFinite(perUnit) || perUnit <= 0) {
        throw new BadRequestError('procurement.landed_cost.product_lacks_attribute', {
          product: product?.name ?? line.description,
          attribute,
        });
      }
      return line.quantity * perUnit;
    });
  }
}

function pick(line: { receiptId: string; productId: string; description: string; quantity: number }) {
  return { receiptId: line.receiptId, productId: line.productId, description: line.description, quantity: line.quantity };
}

/** Split an amount in proportion to weights, cents by largest remainder, so the shares sum exactly. */
export function allocate(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) throw new BadRequestError('procurement.landed_cost.nothing_to_allocate_over');
  const cents = Math.round(amount * 100);
  const raw = weights.map((w) => (Math.max(0, w) / total) * cents);
  const floors = raw.map(Math.floor);
  let left = cents - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - floors[i], i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((c) => c / 100);
}
