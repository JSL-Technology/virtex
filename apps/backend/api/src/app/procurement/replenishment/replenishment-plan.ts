import { ReorderSuggestion } from '../../contracts/ai/reorder-suggestions.contract';

/**
 * Turning the forecast's reorder quantities into purchase orders. Pure: the service gathers the
 * facts (who supplies each product, at what price, what is already on order), this decides.
 *
 * - **Supplier:** the one the product was last bought from (a confirmed order), at that price. A
 *   product never bought has no supplier to ask, and is reported instead of guessed.
 * - **Quantity:** what the forecast suggests minus what is already on order and not yet received —
 *   including drafts this agent wrote before, so running it twice orders nothing twice.
 * - **Grouping:** one order per supplier, branch and currency.
 * - **Limit:** an order above the company's maximum stays a draft for a person, even when the agent
 *   is allowed to send its orders for approval.
 */
export interface LastPurchase {
  supplierId: string;
  unitPrice: number;
  taxRate: number | null;
  currencyCode: string;
  unitOfMeasure: string | null;
}

export interface PlannedLine {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number | null;
  unitOfMeasure: string | null;
  stockoutDate: string | null;
}

export interface PlannedOrder {
  supplierId: string;
  branchId: string | null;
  currencyCode: string;
  lines: PlannedLine[];
  /** Before tax. */
  amount: number;
  withinLimit: boolean;
}

export type SkipReason = 'no_supplier' | 'already_on_order';

export interface ReplenishmentPlan {
  orders: PlannedOrder[];
  skipped: Array<{ productId: string; reason: SkipReason }>;
}

export function planReplenishment(input: {
  suggestions: ReorderSuggestion[];
  warehouseIds: string[] | null;
  lastPurchase: Map<string, LastPurchase>;
  openQuantity: Map<string, number>;
  productNames: Map<string, string>;
  maxOrderAmount: number | null;
}): ReplenishmentPlan {
  const skipped: ReplenishmentPlan['skipped'] = [];
  const wanted = input.warehouseIds?.length ? new Set(input.warehouseIds) : null;

  // One product may be short in several warehouses of one branch: one line, summed.
  const perProduct = new Map<string, { suggestion: ReorderSuggestion; quantity: number }>();
  for (const suggestion of input.suggestions) {
    if (wanted && !wanted.has(suggestion.warehouseId)) continue;
    const key = `${suggestion.productId}|${suggestion.branchId ?? ''}`;
    const current = perProduct.get(key);
    if (current) {
      current.quantity += suggestion.suggestedQty;
      if (suggestion.stockoutDate && (!current.suggestion.stockoutDate || suggestion.stockoutDate < current.suggestion.stockoutDate)) {
        current.suggestion = { ...current.suggestion, stockoutDate: suggestion.stockoutDate };
      }
    } else {
      perProduct.set(key, { suggestion, quantity: suggestion.suggestedQty });
    }
  }

  // What is on order covers the product once, across branches: consumed as it is assigned.
  const remainingOpen = new Map(input.openQuantity);
  const groups = new Map<string, PlannedOrder>();
  for (const { suggestion, quantity } of perProduct.values()) {
    const purchase = input.lastPurchase.get(suggestion.productId);
    if (!purchase) {
      skipped.push({ productId: suggestion.productId, reason: 'no_supplier' });
      continue;
    }
    const open = remainingOpen.get(suggestion.productId) ?? 0;
    const needed = round6(quantity - open);
    remainingOpen.set(suggestion.productId, Math.max(open - quantity, 0));
    if (needed <= 0) {
      skipped.push({ productId: suggestion.productId, reason: 'already_on_order' });
      continue;
    }
    const key = `${purchase.supplierId}|${suggestion.branchId ?? ''}|${purchase.currencyCode}`;
    const order =
      groups.get(key) ??
      ({ supplierId: purchase.supplierId, branchId: suggestion.branchId, currencyCode: purchase.currencyCode, lines: [], amount: 0, withinLimit: true } as PlannedOrder);
    order.lines.push({
      productId: suggestion.productId,
      description: input.productNames.get(suggestion.productId) ?? suggestion.productId,
      quantity: Math.ceil(needed),
      unitPrice: purchase.unitPrice,
      taxRate: purchase.taxRate,
      unitOfMeasure: purchase.unitOfMeasure,
      stockoutDate: suggestion.stockoutDate,
    });
    groups.set(key, order);
  }

  const orders = [...groups.values()].map((order) => {
    const amount = Math.round(order.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;
    return {
      ...order,
      // Most urgent first, so a person reading the draft sees what runs out soonest at the top.
      lines: order.lines.sort((a, b) => (a.stockoutDate ?? '9999').localeCompare(b.stockoutDate ?? '9999')),
      amount,
      withinLimit: input.maxOrderAmount === null || amount <= input.maxOrderAmount,
    };
  });
  return { orders, skipped };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
