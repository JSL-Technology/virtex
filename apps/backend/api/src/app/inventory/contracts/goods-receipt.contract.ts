import { EntityManager } from 'typeorm';

/** One line of goods arriving from a supplier. */
export interface GoodsReceiptLine {
  productId: string | null;
  quantity: number;
  /** Unit cost in the books' currency. */
  unitCost: number;
  description: string;
}

export interface GoodsReceiptRequest {
  /** The human reference: the order number. */
  reference: string;
  /** What produced it — `purchase_order_receipt` — and its id, for the stock ledger. */
  sourceType: string;
  sourceId: string;
  /** Booking date of the receipt entry (YYYY-MM-DD). */
  date: string;
  lines: ReadonlyArray<GoodsReceiptLine>;
  /** False when the caller already booked the goods itself; stock and cost still move. */
  post?: boolean;
  /**
   * Where the goods arrive: a warehouse the document names, or the branch it was issued at.
   * Omitted, the company's default warehouse.
   */
  place?: { warehouseId?: string | null; branchId?: string | null };
}

export interface GoodsReceiptResult {
  /** The entry Dr Inventory / Cr Goods received not invoiced, or null when nothing was valued. */
  journalEntryId: string | null;
  /** Per line, whether stock moved (false for services and free-text lines). */
  stocked: boolean[];
  /** The warehouse the goods went into; null when nothing was stocked. */
  warehouseId: string | null;
}

/**
 * How another module brings goods into stock (QA C-07).
 *
 * Purchasing records a delivery; Inventory owns what that means — the stock balance, the unit
 * cost, the stock ledger and the entry that values it. The port is what Purchasing sees, so it
 * never reaches into Inventory's service. It takes the caller's manager on purpose: a receipt that
 * moved stock but did not post, or posted without moving stock, is exactly the drift the receipt
 * exists to prevent, so both happen in the caller's transaction or neither does.
 */
export abstract class GoodsReceiptPort {
  abstract receiveGoods(
    manager: EntityManager,
    organizationId: string,
    receipt: GoodsReceiptRequest,
    actorUserId: string | null,
  ): Promise<GoodsReceiptResult>;
}
