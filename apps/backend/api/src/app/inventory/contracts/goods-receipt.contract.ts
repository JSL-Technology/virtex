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

/** Goods that arrived going back out, because the receipt that brought them in is voided. */
export interface GoodsReturnRequest {
  /** The receipt's number, repeated on the stock ledger and the reversal. */
  reference: string;
  sourceType: string;
  sourceId: string;
  /** Booking date of the reversal (YYYY-MM-DD). */
  date: string;
  reason: string;
  /** The warehouse the receipt put the goods into. */
  warehouseId: string | null;
  /** Whether the receipt posted an entry: a receipt that booked nothing returns without one. */
  posted: boolean;
  /** Only the lines that moved stock, at the cost they came in at. */
  lines: ReadonlyArray<{ productId: string; quantity: number; unitCost: number }>;
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

  /**
   * Undo a receipt: the goods leave the warehouse they entered at the cost they entered at, the
   * average cost gives that value back, and a return entry (Dr GRNI / Cr Inventory) books it.
   * Refused — by the stock ledger — when the warehouse no longer holds them: goods already sold
   * cannot be un-received. Returns the return entry's id, or null when nothing was valued.
   */
  abstract returnGoods(
    manager: EntityManager,
    organizationId: string,
    request: GoodsReturnRequest,
    actorUserId: string | null,
  ): Promise<string | null>;
}
