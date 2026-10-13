import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EngineRunsService } from '../engine/engine-runs.service';
import { AiInventoryStatus } from '../entities/ai-inventory-insight.entity';

export interface InsightQuery {
  branchId?: string;
  warehouseId?: string;
  status?: AiInventoryStatus;
  search?: string;
  sort?: 'risk' | 'top_sellers';
  limit?: number;
  offset?: number;
}

const STATUS_ORDER = `CASE i."status"
  WHEN 'STOCKOUT_RISK' THEN 0 WHEN 'REORDER' THEN 1 WHEN 'OVERSTOCK' THEN 2
  WHEN 'DEAD_STOCK' THEN 3 ELSE 4 END`;

/**
 * Reading what the forecasting engine wrote.
 *
 * Every figure comes from `ai_inventory_insights` and `ai_forecasts`, which only the engine writes;
 * this service joins them to the names a person recognises and filters them. It computes nothing,
 * so what the screen shows is exactly what the run produced and can be traced to it.
 */
@Injectable()
export class ForecastingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly runs: EngineRunsService,
  ) {}

  async summary(organizationId: string) {
    const counts: Array<{ status: string; n: string }> = await this.dataSource.query(
      `SELECT "status", COUNT(*) AS "n" FROM "ai_inventory_insights"
        WHERE "organization_id" = $1 GROUP BY "status"`,
      [organizationId],
    );
    const byStatus = Object.fromEntries(counts.map((row) => [row.status, Number(row.n)]));
    const [lastRun, lastSuccess] = await Promise.all([
      this.runs.latest(organizationId, 'FORECAST'),
      this.runs.latestSucceeded(organizationId, 'FORECAST'),
    ]);
    return {
      byStatus,
      lastRun: lastRun && {
        id: lastRun.id,
        status: lastRun.status,
        createdAt: lastRun.createdAt,
        finishedAt: lastRun.finishedAt,
        error: lastRun.status === 'FAILED' ? 'failed' : null,
      },
      lastSuccess: lastSuccess && {
        id: lastSuccess.id,
        finishedAt: lastSuccess.finishedAt,
        metrics: lastSuccess.metrics,
        engineVersion: lastSuccess.engineVersion,
      },
    };
  }

  async insights(organizationId: string, query: InsightQuery) {
    const params: unknown[] = [organizationId];
    const where: string[] = ['i."organization_id" = $1'];
    if (query.branchId) {
      params.push(query.branchId);
      where.push(`i."branch_id" = $${params.length}`);
    }
    if (query.warehouseId) {
      params.push(query.warehouseId);
      where.push(`i."warehouse_id" = $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`i."status" = $${params.length}`);
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim().replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`(p."name" ILIKE $${params.length} OR p."sku" ILIKE $${params.length})`);
    }
    const order =
      query.sort === 'top_sellers'
        ? `i."forecast_30d" DESC, p."name" ASC`
        : `${STATUS_ORDER}, i."stockout_date" ASC NULLS LAST, i."forecast_30d" DESC`;
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);

    const rows = await this.dataSource.query(
      `SELECT i."product_id" AS "productId", p."name" AS "productName", p."sku",
              i."warehouse_id" AS "warehouseId", w."name" AS "warehouseName",
              i."branch_id" AS "branchId", b."name" AS "branchName",
              i."on_hand"::float AS "onHand", i."avg_daily_demand"::float AS "avgDailyDemand",
              i."forecast_30d"::float AS "forecast30d", i."forecast_30d_p90"::float AS "forecast30dP90",
              i."days_of_cover"::float AS "daysOfCover", to_char(i."stockout_date", 'YYYY-MM-DD') AS "stockoutDate",
              i."lead_time_days"::float AS "leadTimeDays", i."safety_stock"::float AS "safetyStock",
              i."reorder_point"::float AS "reorderPoint", i."suggested_order_qty"::float AS "suggestedOrderQty",
              i."service_level"::float AS "serviceLevel", i."status", i."branch_rank" AS "branchRank",
              i."model", i."accuracy_wape"::float AS "accuracyWape", i."censored_days" AS "censoredDays",
              COUNT(*) OVER() AS "total"
         FROM "ai_inventory_insights" i
         JOIN "products" p ON p."id" = i."product_id"
         JOIN "warehouses" w ON w."id" = i."warehouse_id"
         LEFT JOIN "branches" b ON b."id" = i."branch_id"
        WHERE ${where.join(' AND ')}
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { total, items: rows.map(({ total: _total, ...row }: Record<string, unknown>) => row) };
  }

  /** The best sellers of each branch over the next 30 days: "what will sell most, and where". */
  async topByBranch(organizationId: string, perBranch = 10) {
    const limit = Math.min(Math.max(perBranch, 1), 50);
    return this.dataSource.query(
      `SELECT * FROM (
         SELECT b."id" AS "branchId", COALESCE(b."name", '') AS "branchName",
                p."id" AS "productId", p."name" AS "productName", p."sku",
                SUM(i."forecast_30d")::float AS "forecast30d", SUM(i."on_hand")::float AS "onHand",
                ROW_NUMBER() OVER (PARTITION BY b."id" ORDER BY SUM(i."forecast_30d") DESC) AS "rank"
           FROM "ai_inventory_insights" i
           JOIN "products" p ON p."id" = i."product_id"
           LEFT JOIN "branches" b ON b."id" = i."branch_id"
          WHERE i."organization_id" = $1
          GROUP BY b."id", b."name", p."id", p."name", p."sku"
       ) ranked
       WHERE ranked."rank" <= ${limit} AND ranked."forecast30d" > 0
       ORDER BY ranked."branchName", ranked."rank"`,
      [organizationId],
    );
  }

  /** History and forecast of one series, for the chart: actual units sold, then P10/P50/P90 ahead. */
  async series(organizationId: string, productId: string, warehouseId: string, historyDays = 180) {
    const days = Math.min(Math.max(historyDays, 7), 730);
    const [history, forecast] = await Promise.all([
      this.dataSource.query(
        `SELECT to_char("day", 'YYYY-MM-DD') AS "date", ("qty_sold" - "qty_returned")::float AS "quantity"
           FROM "ai_src_daily_demand"
          WHERE "organization_id" = $1 AND "product_id" = $2 AND "warehouse_id" = $3
            AND "day" >= CURRENT_DATE - $4::int
          ORDER BY "day"`,
        [organizationId, productId, warehouseId, days],
      ),
      this.dataSource.query(
        `SELECT to_char(f."forecast_date", 'YYYY-MM-DD') AS "date",
                f."p10"::float AS "p10", f."p50"::float AS "p50", f."p90"::float AS "p90", f."model"
           FROM "ai_forecasts" f
          WHERE f."organization_id" = $1 AND f."product_id" = $2 AND f."warehouse_id" = $3
          ORDER BY f."forecast_date"`,
        [organizationId, productId, warehouseId],
      ),
    ]);
    return { history, forecast };
  }
}
