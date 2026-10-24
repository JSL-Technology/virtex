/**
 * Which open purchase order a supplier's bill is for, when it is clear.
 *
 * A bill arriving by mail rarely names the order, and the buyer who placed it is not the person
 * entering it. The supplier's open orders are scored by how well they explain the bill: the total
 * (within 2 %, or within what is still to be billed), and the share of the bill's products that are
 * on the order with quantity left to bill. One clear winner is linked; two close ones are left for
 * a person — a wrong link would mis-match the receipt and the payment.
 */
export interface OpenOrder {
  id: string;
  number: string;
  total: number;
  /** What has not been billed yet, at order prices. */
  unbilled: number;
  lines: Array<{ id: string; productId: string | null; quantity: number; billedQuantity: number }>;
}

export interface BillToMatch {
  total: number | null;
  lines: Array<{ productId: string | null; quantity: number | null }>;
}

export interface OrderMatch {
  orderId: string;
  number: string;
  score: number;
  /** Bill line index → order line id, for the lines that matched a product with quantity left. */
  lineMap: Record<number, string>;
}

const TOTAL_TOLERANCE = 0.02;
const MIN_SCORE = 0.6;
const CLEAR_MARGIN = 0.2;

export function scoreOrder(order: OpenOrder, bill: BillToMatch): OrderMatch {
  let score = 0;
  if (bill.total !== null && bill.total > 0) {
    const close = (target: number) => target > 0 && Math.abs(target - bill.total!) / target <= TOTAL_TOLERANCE;
    if (close(order.total) || close(order.unbilled)) score += 0.5;
  }
  const lineMap: Record<number, string> = {};
  const used = new Set<string>();
  const withProduct = bill.lines.map((line, index) => ({ line, index })).filter(({ line }) => line.productId);
  for (const { line, index } of withProduct) {
    const candidate = order.lines.find(
      (orderLine) => !used.has(orderLine.id) && orderLine.productId === line.productId && orderLine.quantity - orderLine.billedQuantity >= (line.quantity ?? 0) - 1e-9,
    );
    if (candidate) {
      lineMap[index] = candidate.id;
      used.add(candidate.id);
    }
  }
  if (withProduct.length) score += 0.5 * (Object.keys(lineMap).length / withProduct.length);
  return { orderId: order.id, number: order.number, score, lineMap };
}

/** The order the bill is clearly for, or null when none or several fit. */
export function matchPurchaseOrder(orders: OpenOrder[], bill: BillToMatch): OrderMatch | null {
  const scored = orders.map((order) => scoreOrder(order, bill)).sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (!best || best.score < MIN_SCORE) return null;
  if (next && best.score - next.score < CLEAR_MARGIN) return null;
  return best;
}
