import type { CatalogueItem } from '../core/pos-api.service';
import { round2, sum } from './money';

/** One line of the open ticket. */
export interface CartLine {
  productId: string;
  name: string;
  sku: string | null;
  /** Unit price before tax, as the catalogue held it when the line was added (or last repriced). */
  price: number;
  quantity: number;
  /** The server-resolved rate (`CatalogueItem.taxRate`). */
  taxRate: number;
  kind: 'GOOD' | 'SERVICE';
  /** On hand when the catalogue was last loaded; a service has no limit. */
  stock: number;
}

export interface CartTotals {
  subtotal: number;
  tax: number;
  total: number;
  /** Units on the ticket. */
  units: number;
  /** The single rate on the ticket, or null when its lines carry different ones. */
  rate: number | null;
}

/**
 * Each line priced exactly as the server prices it: per line, rounded to the cent, then summed.
 * The server stays the authority — it re-prices from the catalogue and refuses a sale whose
 * customer saw a different amount (`pos.totals_changed`) — so this only has to agree with it.
 */
export function lineSubtotal(
  line: Pick<CartLine, 'price' | 'quantity'>,
): number {
  return round2(line.price * line.quantity);
}

export function lineTax(
  line: Pick<CartLine, 'price' | 'quantity' | 'taxRate'>,
): number {
  return round2(lineSubtotal(line) * line.taxRate);
}

export function lineTotal(
  line: Pick<CartLine, 'price' | 'quantity' | 'taxRate'>,
): number {
  return round2(lineSubtotal(line) + lineTax(line));
}

export function cartTotals(
  lines: readonly CartLine[],
  standardRate = 0,
): CartTotals {
  const subtotal = sum(lines.map(lineSubtotal));
  const tax = sum(lines.map(lineTax));
  const rates = [...new Set(lines.map((line) => line.taxRate))];
  return {
    subtotal,
    tax,
    total: round2(subtotal + tax),
    units: lines.reduce((acc, line) => acc + line.quantity, 0),
    rate:
      rates.length === 0 ? standardRate : rates.length === 1 ? rates[0] : null,
  };
}

/** A good is out of stock when none is on hand; a service never is. */
export function isOutOfStock(
  item: Pick<CatalogueItem, 'kind' | 'stock'>,
): boolean {
  return item.kind !== 'SERVICE' && Number(item.stock ?? 0) <= 0;
}

export type CartChange = {
  lines: CartLine[];
  refused?: { reason: 'not_enough_stock'; available: number };
};

/**
 * Add `quantity` of a product. A good cannot be sold beyond what is on hand — the server refuses
 * the whole sale when one line is short — so it is said at the counter, on the item, before the
 * cashier charges the customer.
 */
export function addToCart(
  lines: readonly CartLine[],
  item: CatalogueItem,
  quantity = 1,
): CartChange {
  const existing = lines.find((line) => line.productId === item.id);
  const wanted = (existing?.quantity ?? 0) + quantity;
  if (item.kind !== 'SERVICE' && wanted > Number(item.stock ?? 0)) {
    return {
      lines: [...lines],
      refused: {
        reason: 'not_enough_stock',
        available: Number(item.stock ?? 0),
      },
    };
  }
  if (existing) {
    return {
      lines: lines.map((line) =>
        line.productId === item.id ? { ...line, quantity: wanted } : line,
      ),
    };
  }
  return {
    lines: [
      ...lines,
      {
        productId: item.id,
        name: item.name,
        sku: item.sku,
        price: Number(item.price),
        quantity,
        taxRate: Number(item.taxRate) || 0,
        kind: item.kind,
        stock: Number(item.stock ?? 0),
      },
    ],
  };
}

/** Set a line's quantity; zero or less removes it. Bounded by stock for goods. */
export function setQuantity(
  lines: readonly CartLine[],
  productId: string,
  quantity: number,
): CartChange {
  const line = lines.find((l) => l.productId === productId);
  if (!line) return { lines: [...lines] };
  const qty = Math.floor(Number(quantity) || 0);
  if (qty <= 0)
    return { lines: lines.filter((l) => l.productId !== productId) };
  if (line.kind !== 'SERVICE' && qty > line.stock) {
    return {
      lines: [...lines],
      refused: { reason: 'not_enough_stock', available: line.stock },
    };
  }
  return {
    lines: lines.map((l) =>
      l.productId === productId ? { ...l, quantity: qty } : l,
    ),
  };
}

/**
 * Bring every open line to the catalogue's current price, rate and stock; drop lines whose product
 * is no longer sold. What the till does when the server says the prices moved under it.
 */
export function repriceCart(
  lines: readonly CartLine[],
  catalogue: readonly CatalogueItem[],
): CartLine[] {
  const byId = new Map(catalogue.map((item) => [item.id, item]));
  return lines.flatMap((line) => {
    const item = byId.get(line.productId);
    if (!item) return [];
    return [
      {
        ...line,
        name: item.name,
        price: Number(item.price),
        taxRate: Number(item.taxRate) || 0,
        stock: Number(item.stock ?? 0),
      },
    ];
  });
}

/**
 * The catalogue item a scan or a typed code names: an exact barcode or SKU match, case-insensitive.
 * A handheld scanner types the code and Enter into the focused search box, so this is the whole of
 * barcode support — no driver, no device pairing.
 */
export function findByCode(
  catalogue: readonly CatalogueItem[],
  code: string,
): CatalogueItem | undefined {
  const wanted = code.trim().toLocaleLowerCase();
  if (!wanted) return undefined;
  return catalogue.find(
    (item) =>
      item.barcode?.toLocaleLowerCase() === wanted ||
      item.sku?.toLocaleLowerCase() === wanted,
  );
}

/** Name, SKU or barcode contain the term; optionally within one category. */
export function filterCatalogue(
  catalogue: readonly CatalogueItem[],
  term: string,
  categoryId: string | null = null,
): CatalogueItem[] {
  const wanted = term.trim().toLocaleLowerCase();
  return catalogue.filter((item) => {
    if (categoryId && item.categoryId !== categoryId) return false;
    if (!wanted) return true;
    return (
      item.name.toLocaleLowerCase().includes(wanted) ||
      (item.sku ?? '').toLocaleLowerCase().includes(wanted) ||
      (item.barcode ?? '').toLocaleLowerCase().includes(wanted)
    );
  });
}
