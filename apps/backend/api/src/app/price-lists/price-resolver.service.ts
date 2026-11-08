import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PriceListStatus } from './entities/price-list.entity';

/** What is being priced: one product, at one quantity. */
export interface PriceQuery {
  productId: string;
  quantity: number;
}

/** Who buys, in what currency, on what date. */
export interface PricingContext {
  customerId?: string | null;
  currencyCode: string;
  /** `YYYY-MM-DD`: the document's issue date, which is the date its prices are promised for. */
  date: string;
}

/** The list that applies to a context, and why that one. */
export interface ApplicablePriceList {
  id: string;
  name: string;
  currency: string;
  /** `CUSTOMER`: the customer's own list. `DEFAULT`: the organization's list for the currency. */
  basis: 'CUSTOMER' | 'DEFAULT';
}

/** A line priced for a document: the list price where there is one, the catalogue's otherwise. */
export interface PricedLine extends ResolvedPrice {
  /** `PRICE_LIST`, `CATALOGUE`, or `NONE` for a product with no price anywhere. */
  source: 'PRICE_LIST' | 'CATALOGUE' | 'NONE';
  price: number | null;
}

export interface PriceBreak {
  minQuantity: number;
  price: number;
}

export interface ResolvedPrice {
  productId: string;
  quantity: number;
  /** The list price, or `null` when the list does not carry the product (the catalogue applies). */
  unitPrice: number | null;
  priceListId: string | null;
  priceListName: string | null;
  /** The quantity break that matched, when the list price applied. */
  minQuantity: number | null;
}

/**
 * Which price a sales document charges, decided once for every channel (audit 2026-11-07, FAC-PL-01).
 *
 * Lists were created, dated and filled with prices, and nothing read them: the invoice charged
 * `dto.unitPrice ?? product.price`, the quote whatever the form sent and the till the catalogue
 * price. A tenant that set up a «Mayorista» list kept billing at retail.
 *
 * The rule, in order:
 *
 *  1. the customer's own list, if it is ACTIVE, in force on the document's date and in the
 *     document's currency;
 *  2. otherwise the organization's default list for that currency, on the same conditions;
 *  3. within the list, the price of the largest quantity break the line reaches;
 *  4. a product the list does not carry, or no list at all: `unitPrice: null`, and the caller uses
 *     the catalogue price — a list is a set of exceptions, not a second catalogue to keep complete.
 *
 * A list in another currency is never converted: a price promised in dollars is not a price in
 * pesos at today's rate, and silently converting it is how a quoted price drifts.
 */
@Injectable()
export class PriceResolver {
  constructor(private readonly dataSource: DataSource) {}

  /** The list a document for this context is priced at, or `null` when none applies. */
  async applicableList(
    organizationId: string,
    context: PricingContext,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<ApplicablePriceList | null> {
    const currency = context.currencyCode.trim().toUpperCase();
    const rows: Array<{ id: string; name: string; currency: string; basis: 'CUSTOMER' | 'DEFAULT' }> = await manager.query(
      `SELECT pl.id, pl.name, pl.currency,
              CASE WHEN pl.id = c.price_list_id THEN 'CUSTOMER' ELSE 'DEFAULT' END AS basis
         FROM price_lists pl
         LEFT JOIN customers c ON c.id = $4::uuid AND c.organization_id = $1
        WHERE pl.organization_id = $1
          AND pl.status = $5
          AND upper(pl.currency) = $2
          AND $3::date BETWEEN pl."validFrom" AND pl."validTo"
          AND (pl.id = c.price_list_id OR pl.is_default)
        ORDER BY (pl.id = c.price_list_id) DESC NULLS LAST
        LIMIT 1`,
      [organizationId, currency, context.date, context.customerId ?? null, PriceListStatus.ACTIVE],
    );
    return rows[0] ?? null;
  }

  /** Every break the list holds for these products, ascending by minimum quantity. */
  async breaks(
    priceListId: string,
    productIds: readonly string[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, PriceBreak[]>> {
    const ids = [...new Set(productIds.filter(Boolean))];
    const out = new Map<string, PriceBreak[]>();
    if (ids.length === 0) return out;
    const rows: Array<{ product_id: string; min_quantity: string; price: string }> = await manager.query(
      `SELECT product_id, min_quantity, price
         FROM price_list_items
        WHERE price_list_id = $1 AND product_id = ANY($2::uuid[])
        ORDER BY product_id, min_quantity`,
      [priceListId, ids],
    );
    for (const row of rows) {
      const list = out.get(row.product_id) ?? [];
      list.push({ minQuantity: Number(row.min_quantity), price: Number(row.price) });
      out.set(row.product_id, list);
    }
    return out;
  }

  /** The price of each query, in the order given. */
  async resolve(
    organizationId: string,
    context: PricingContext,
    queries: readonly PriceQuery[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<ResolvedPrice[]> {
    const list = await this.applicableList(organizationId, context, manager);
    const breaks = list ? await this.breaks(list.id, queries.map((q) => q.productId), manager) : new Map<string, PriceBreak[]>();
    return queries.map((query) => {
      const match = list ? pickBreak(breaks.get(query.productId), query.quantity) : null;
      return {
        productId: query.productId,
        quantity: query.quantity,
        unitPrice: match?.price ?? null,
        priceListId: match ? list!.id : null,
        priceListName: match ? list!.name : null,
        minQuantity: match?.minQuantity ?? null,
      };
    });
  }

  /**
   * {@link resolve}, completed with the catalogue price for what no list carries — what a form
   * shows while a document is being composed. The catalogue price is in the base currency, so in
   * a document in another currency it is offered only when the document is in the base currency.
   */
  async priceLines(
    organizationId: string,
    context: PricingContext,
    queries: readonly PriceQuery[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<PricedLine[]> {
    const resolved = await this.resolve(organizationId, context, queries, manager);
    const baseRows: Array<{ currency: string | null }> = await manager.query(
      `SELECT base_currency AS currency FROM organization_settings WHERE organization_id = $1`,
      [organizationId],
    );
    const inBaseCurrency = (baseRows[0]?.currency ?? context.currencyCode).toUpperCase() === context.currencyCode.toUpperCase();
    const missing = resolved.filter((line) => line.unitPrice === null).map((line) => line.productId);
    const catalogue = new Map<string, number>();
    if (missing.length && inBaseCurrency) {
      const rows: Array<{ id: string; price: string | null }> = await manager.query(
        `SELECT id, price FROM products WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [organizationId, [...new Set(missing)]],
      );
      for (const row of rows) if (row.price !== null) catalogue.set(row.id, Number(row.price));
    }
    return resolved.map((line) => {
      if (line.unitPrice !== null) return { ...line, source: 'PRICE_LIST', price: line.unitPrice };
      const price = catalogue.get(line.productId);
      return price === undefined ? { ...line, source: 'NONE', price: null } : { ...line, source: 'CATALOGUE', price };
    });
  }
}

/**
 * The break with the largest minimum the quantity reaches. Below the smallest minimum, none: a
 * list that starts at 12 units says nothing about the price of one.
 */
export function pickBreak(breaks: readonly PriceBreak[] | undefined, quantity: number): PriceBreak | null {
  if (!breaks?.length) return null;
  let best: PriceBreak | null = null;
  for (const candidate of breaks) {
    if (candidate.minQuantity <= quantity + 1e-9 && (!best || candidate.minQuantity > best.minQuantity)) best = candidate;
  }
  return best;
}
