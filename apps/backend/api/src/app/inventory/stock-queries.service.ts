import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StockMovementsQueryDto, StockOnHandQueryDto } from './dto/stock-query.dto';
import { likeTerm } from '../common/database/search-term';
import { roundAmount } from '../common/money';

export interface StockOnHandRow {
  productId: string;
  sku: string | null;
  name: string;
  warehouseId: string;
  warehouseName: string;
  quantityOnHand: number;
  reorderLevel: number | null;
  unitCost: number;
  value: number;
}

export interface StockMovementRow {
  id: string;
  date: string;
  productId: string;
  sku: string | null;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  type: string;
  reference: string;
  sourceType: string | null;
  sourceId: string | null;
  quantity: number;
  unitCost: number;
  value: number;
  /** What was held after this movement — in the warehouse when one is filtered, else company-wide. */
  balance: number;
}

const page = (query: { page?: number; limit?: number }) => {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const current = Math.max(query.page ?? 1, 1);
  return { limit, offset: (current - 1) * limit, page: current };
};

/**
 * What is held and how it got there: the two questions every inventory screen starts from.
 *
 * Read with SQL rather than entities because both are aggregates over the ledger: the stock
 * register joins balances to the catalogue and values them, and the kardex needs a running balance,
 * which is a window function — computed over the whole history and only then cut to the dates
 * asked for, so the first row of March starts from what was held at the end of February.
 */
@Injectable()
export class StockQueriesService {
  constructor(private readonly dataSource: DataSource) {}

  async onHand(organizationId: string, query: StockOnHandQueryDto) {
    const { limit, offset, page: current } = page(query);
    const params: unknown[] = [organizationId];
    const where = [`l."organization_id" = $1`];
    if (query.warehouseId) {
      params.push(query.warehouseId);
      where.push(`l."warehouse_id" = $${params.length}`);
    }
    if (query.productId) {
      params.push(query.productId);
      where.push(`l."product_id" = $${params.length}`);
    }
    const term = likeTerm(query.search);
    if (term) {
      params.push(term);
      where.push(`(p."name" ILIKE $${params.length} OR p."sku" ILIKE $${params.length})`);
    }
    if (!query.includeZero) where.push(`l."quantity_on_hand" <> 0`);

    const from = `
      FROM "stock_levels" l
      JOIN "products" p ON p."id" = l."product_id"
      JOIN "warehouses" w ON w."id" = l."warehouse_id"
     WHERE ${where.join(' AND ')}`;

    const [rows, [totals]] = await Promise.all([
      this.dataSource.query(
        `SELECT l."product_id" AS "productId", p."sku", p."name", l."warehouse_id" AS "warehouseId",
                w."name" AS "warehouseName", l."quantity_on_hand" AS "quantityOnHand",
                p."reorder_level" AS "reorderLevel", p."cost" AS "unitCost"
         ${from}
         ORDER BY p."name" ASC, w."name" ASC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS "count", COALESCE(SUM(l."quantity_on_hand" * p."cost"), 0) AS "value" ${from}`,
        params,
      ),
    ]);

    const items: StockOnHandRow[] = rows.map((row: Record<string, unknown>) => {
      const quantity = Number(row['quantityOnHand']);
      const unitCost = Number(row['unitCost']);
      return {
        productId: row['productId'] as string,
        sku: (row['sku'] as string | null) ?? null,
        name: row['name'] as string,
        warehouseId: row['warehouseId'] as string,
        warehouseName: row['warehouseName'] as string,
        quantityOnHand: quantity,
        reorderLevel: row['reorderLevel'] === null ? null : Number(row['reorderLevel']),
        unitCost,
        value: roundAmount(quantity * unitCost),
      };
    });
    const total = Number(totals?.count ?? 0);
    return {
      items,
      total,
      page: current,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      totalValue: roundAmount(Number(totals?.value ?? 0)),
    };
  }

  async movements(organizationId: string, query: StockMovementsQueryDto) {
    const { limit, offset, page: current } = page(query);
    const params: unknown[] = [organizationId];
    const scope = [`m."organization_id" = $1`];
    if (query.productId) {
      params.push(query.productId);
      scope.push(`m."product_id" = $${params.length}`);
    }
    if (query.warehouseId) {
      params.push(query.warehouseId);
      scope.push(`m."warehouse_id" = $${params.length}`);
    }
    // The balance runs per warehouse when one is asked for, else per product across the company.
    const partition = query.warehouseId ? `m."product_id", m."warehouse_id"` : `m."product_id"`;

    const cut: string[] = [];
    if (query.from) {
      params.push(query.from);
      cut.push(`"date" >= $${params.length}::date`);
    }
    if (query.to) {
      params.push(query.to);
      cut.push(`"date" < ($${params.length}::date + 1)`);
    }
    if (query.type) {
      params.push(query.type);
      cut.push(`"type" = $${params.length}`);
    }

    const ledger = `
      WITH ledger AS (
        SELECT m."id", m."date", m."product_id", m."warehouse_id", m."type", m."reference",
               m."source_type", m."source_id", m."quantity", m."cost",
               SUM(m."quantity") OVER (PARTITION BY ${partition} ORDER BY m."date", m."id"
                                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "balance"
          FROM "stock_movements" m
         WHERE ${scope.join(' AND ')}
      )`;
    const filtered = `FROM ledger ${cut.length ? `WHERE ${cut.join(' AND ')}` : ''}`;

    const [rows, [count]] = await Promise.all([
      this.dataSource.query(
        `${ledger}
         SELECT l."id", l."date", l."product_id" AS "productId", p."sku", p."name" AS "productName",
                l."warehouse_id" AS "warehouseId", w."name" AS "warehouseName", l."type", l."reference",
                l."source_type" AS "sourceType", l."source_id" AS "sourceId", l."quantity", l."cost", l."balance"
           FROM (SELECT * ${filtered}) l
           JOIN "products" p ON p."id" = l."product_id"
           JOIN "warehouses" w ON w."id" = l."warehouse_id"
          ORDER BY l."date" ASC, l."id" ASC
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      this.dataSource.query(`${ledger} SELECT COUNT(*)::int AS "count" ${filtered}`, params),
    ]);

    // What was held before the first row asked for: the kardex opens with it.
    let openingBalance: number | null = null;
    if (query.productId && query.from) {
      const openingParams: unknown[] = [organizationId, query.productId, query.from];
      let warehouseClause = '';
      if (query.warehouseId) {
        openingParams.push(query.warehouseId);
        warehouseClause = `AND "warehouse_id" = $4`;
      }
      const [opening] = await this.dataSource.query(
        `SELECT COALESCE(SUM("quantity"), 0) AS "balance" FROM "stock_movements"
          WHERE "organization_id" = $1 AND "product_id" = $2 AND "date" < $3::date ${warehouseClause}`,
        openingParams,
      );
      openingBalance = Number(opening?.balance ?? 0);
    }

    const items: StockMovementRow[] = rows.map((row: Record<string, unknown>) => {
      const quantity = Number(row['quantity']);
      const unitCost = Number(row['cost']);
      return {
        id: row['id'] as string,
        date: new Date(row['date'] as string).toISOString(),
        productId: row['productId'] as string,
        sku: (row['sku'] as string | null) ?? null,
        productName: row['productName'] as string,
        warehouseId: row['warehouseId'] as string,
        warehouseName: row['warehouseName'] as string,
        type: row['type'] as string,
        reference: row['reference'] as string,
        sourceType: (row['sourceType'] as string | null) ?? null,
        sourceId: (row['sourceId'] as string | null) ?? null,
        quantity,
        unitCost,
        value: roundAmount(quantity * unitCost),
        balance: Number(row['balance']),
      };
    });
    const total = Number(count?.count ?? 0);
    return { items, total, page: current, limit, pages: Math.max(1, Math.ceil(total / limit)), openingBalance };
  }
}
