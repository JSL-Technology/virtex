import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AgentProposal, AgentRunLogPort } from '../../contracts/ai/agent-runs.contract';
import { ReorderSuggestionRegistry } from '../../contracts/ai/reorder-suggestions.contract';
import { EntitlementsPort } from '../../saas/contracts/entitlements.contract';
import { SchedulerLockService } from '../../shared/scheduler/scheduler-lock.service';
import { forEachTenant } from '../../shared/tenancy/tenant-job';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { LastPurchase, planReplenishment } from './replenishment-plan';
import { ReplenishmentAgentSettings } from './replenishment-settings.entity';

/** Orders that still bring stock in. */
const OPEN_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'];

export interface ReplenishmentRunResult {
  runId: string | null;
  orders: AgentProposal[];
  skipped: { noSupplier: number; alreadyOnOrder: number };
  forecastAt: Date | null;
}

/**
 * The replenishment agent: from the forecast's reorder quantities to purchase orders, ready for a
 * person.
 *
 * Every run writes draft purchase orders (see `planReplenishment` for which, to whom and how many)
 * and, when the company allows it, sends those within its limit to the approval flow it already
 * has. It never sends anything to a supplier: an order reaches a supplier only after a person
 * approves it, exactly as one written by hand. Each run, with what it proposed and why it skipped
 * what it skipped, goes to the agents' log (Admin › AI).
 *
 * Off by default; runs every morning for the companies that turned it on (and whose plan includes
 * agents), from a workflow step, or on request.
 */
@Injectable()
export class ReplenishmentAgentService {
  private readonly logger = new Logger(ReplenishmentAgentService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ReplenishmentAgentSettings) private readonly settingsRepo: Repository<ReplenishmentAgentSettings>,
    private readonly orders: PurchaseOrdersService,
    private readonly suggestions: ReorderSuggestionRegistry,
    private readonly entitlements: EntitlementsPort,
    private readonly lock: SchedulerLockService,
    @Optional() private readonly log?: AgentRunLogPort,
  ) {}

  async settings(organizationId: string): Promise<ReplenishmentAgentSettings> {
    return (
      (await this.settingsRepo.findOne({ where: { organizationId } })) ??
      this.settingsRepo.create({ organizationId, enabled: false, warehouseIds: [], submitForApproval: false, maxOrderAmount: null })
    );
  }

  async updateSettings(organizationId: string, changes: Partial<Pick<ReplenishmentAgentSettings, 'enabled' | 'warehouseIds' | 'submitForApproval' | 'maxOrderAmount'>>) {
    const current = await this.settings(organizationId);
    return this.settingsRepo.save({
      ...current,
      ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {}),
      ...(changes.warehouseIds !== undefined ? { warehouseIds: [...new Set(changes.warehouseIds)] } : {}),
      ...(changes.submitForApproval !== undefined ? { submitForApproval: changes.submitForApproval } : {}),
      ...(changes.maxOrderAmount !== undefined ? { maxOrderAmount: changes.maxOrderAmount } : {}),
      organizationId,
    });
  }

  // 07:13: after the night's forecast, before the buyers start their day.
  @Cron('13 7 * * *')
  async daily(): Promise<void> {
    const runKey = new Date().toISOString().slice(0, 10);
    await this.lock.runOnce('replenishment-agent', runKey, async () => {
      await forEachTenant(
        this.dataSource,
        async (organizationId) => {
          if (!(await this.entitlements.checkFeature(organizationId, 'ai_agents'))) return;
          if (!(await this.settings(organizationId)).enabled) return;
          await this.run(organizationId, null, 'SCHEDULED');
        },
        undefined,
        (organizationId, error) => this.logger.error(`Replenishment agent failed for ${organizationId}: ${(error as Error)?.message}`),
      );
    });
  }

  async run(organizationId: string, userId: string | null, trigger: 'SCHEDULED' | 'MANUAL' | 'WORKFLOW'): Promise<ReplenishmentRunResult> {
    const startedAt = new Date();
    const settings = await this.settings(organizationId);
    const proposals: AgentProposal[] = [];
    const notes: Array<{ key: string; params?: Record<string, unknown> }> = [];
    try {
      const { computedAt, items } = await this.suggestions.suggestions(organizationId);
      const productIds = [...new Set(items.map((item) => item.productId))];
      const [lastPurchase, openQuantity, productNames] = productIds.length
        ? await Promise.all([this.lastPurchases(organizationId, productIds), this.openQuantities(organizationId, productIds), this.names(organizationId, productIds)])
        : [new Map<string, LastPurchase>(), new Map<string, number>(), new Map<string, string>()];
      const plan = planReplenishment({
        suggestions: items,
        warehouseIds: settings.warehouseIds?.length ? settings.warehouseIds : null,
        lastPurchase,
        openQuantity,
        productNames,
        maxOrderAmount: settings.maxOrderAmount,
      });

      for (const planned of plan.orders) {
        const order = await this.orders.create(
          {
            supplierId: planned.supplierId,
            branchId: planned.branchId ?? undefined,
            currencyCode: planned.currencyCode,
            notes: 'Borrador del agente de reposición, a partir del pronóstico de demanda.',
            lines: planned.lines.map((line) => ({
              productId: line.productId,
              description: line.description.slice(0, 500),
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              ...(line.taxRate !== null ? { taxRate: line.taxRate } : {}),
              ...(line.unitOfMeasure ? { unitOfMeasure: line.unitOfMeasure.slice(0, 16) } : {}),
            })),
          },
          organizationId,
          userId,
        );
        let state = 'DRAFT';
        if (settings.submitForApproval && planned.withinLimit) {
          await this.orders.submit(order.id, organizationId, userId);
          state = 'PENDING_APPROVAL';
        } else if (settings.submitForApproval) {
          notes.push({ key: 'over_limit', params: { number: order.number, amount: planned.amount, limit: settings.maxOrderAmount } });
        }
        proposals.push({ kind: 'purchase_order', id: order.id, label: order.number, link: `/purchasing/orders/${order.id}/edit`, state });
      }
      const noSupplier = plan.skipped.filter((item) => item.reason === 'no_supplier');
      if (noSupplier.length) {
        notes.push({ key: 'no_supplier', params: { products: noSupplier.slice(0, 10).map((item) => productNames.get(item.productId) ?? item.productId).join(', '), count: noSupplier.length } });
      }
      if (!computedAt) notes.push({ key: 'no_forecast' });
      const result = {
        orders: proposals,
        skipped: { noSupplier: noSupplier.length, alreadyOnOrder: plan.skipped.length - noSupplier.length },
        forecastAt: computedAt,
      };
      const runId = await this.record(organizationId, userId, trigger, startedAt, proposals.length ? 'SUCCEEDED' : 'NOTHING_TO_DO', {
        orders: proposals.length,
        submitted: proposals.filter((proposal) => proposal.state === 'PENDING_APPROVAL').length,
        noSupplier: result.skipped.noSupplier,
        alreadyOnOrder: result.skipped.alreadyOnOrder,
      }, proposals, notes);
      return { runId, ...result };
    } catch (error) {
      notes.push({ key: 'failed', params: { reason: String((error as Error)?.message ?? error).slice(0, 300) } });
      await this.record(organizationId, userId, trigger, startedAt, 'FAILED', { orders: proposals.length }, proposals, notes);
      throw error;
    }
  }

  private async record(
    organizationId: string,
    userId: string | null,
    trigger: 'SCHEDULED' | 'MANUAL' | 'WORKFLOW',
    startedAt: Date,
    status: 'SUCCEEDED' | 'FAILED' | 'NOTHING_TO_DO',
    summary: Record<string, number>,
    proposals: AgentProposal[],
    notes: Array<{ key: string; params?: Record<string, unknown> }>,
  ): Promise<string | null> {
    if (!this.log) return null;
    try {
      return await this.log.record({ organizationId, agent: 'replenishment', trigger, userId, status, summary, proposals, notes, startedAt });
    } catch (error) {
      // The orders exist either way; a lost log line must not undo them.
      this.logger.warn(`Replenishment run could not be logged: ${(error as Error).message}`);
      return null;
    }
  }

  /** Who each product was last bought from, and at what price (confirmed orders only). */
  private async lastPurchases(organizationId: string, productIds: string[]): Promise<Map<string, LastPurchase>> {
    const rows: Array<{ product_id: string; supplier_id: string; unit_price: string; tax_rate: string | null; currency_code: string; unit_of_measure: string | null }> =
      await this.dataSource.query(
        `SELECT DISTINCT ON (l."product_id") l."product_id", o."supplier_id", l."unit_price", l."tax_rate", o."currency_code", l."unit_of_measure"
           FROM "purchase_order_lines" l
           JOIN "purchase_orders" o ON o."id" = l."order_id"
          WHERE o."organization_id" = $1 AND l."product_id" = ANY($2::uuid[]) AND o."status" NOT IN ('DRAFT', 'CANCELLED')
          ORDER BY l."product_id", o."order_date" DESC, o."created_at" DESC`,
        [organizationId, productIds],
      );
    return new Map(
      rows.map((row) => [
        row.product_id,
        { supplierId: row.supplier_id, unitPrice: Number(row.unit_price), taxRate: row.tax_rate === null ? null : Number(row.tax_rate), currencyCode: row.currency_code, unitOfMeasure: row.unit_of_measure },
      ]),
    );
  }

  /** What is ordered and not yet received, drafts included. */
  private async openQuantities(organizationId: string, productIds: string[]): Promise<Map<string, number>> {
    const rows: Array<{ product_id: string; open: string }> = await this.dataSource.query(
      `SELECT l."product_id", SUM(l."quantity" - l."received_quantity") AS open
         FROM "purchase_order_lines" l
         JOIN "purchase_orders" o ON o."id" = l."order_id"
        WHERE o."organization_id" = $1 AND l."product_id" = ANY($2::uuid[]) AND o."status" = ANY($3::text[])
        GROUP BY l."product_id"`,
      [organizationId, productIds, OPEN_STATUSES],
    );
    return new Map(rows.map((row) => [row.product_id, Number(row.open)]));
  }

  private async names(organizationId: string, productIds: string[]): Promise<Map<string, string>> {
    const rows: Array<{ id: string; name: string }> = await this.dataSource.query(
      `SELECT p."id", p."name" FROM "products" p WHERE p."organization_id" = $1 AND p."id" = ANY($2::uuid[])`,
      [organizationId, productIds],
    );
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
