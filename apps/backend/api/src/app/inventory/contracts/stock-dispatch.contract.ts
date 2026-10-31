import { EntityManager } from 'typeorm';

/** Where goods leave from or return to: a branch's warehouse, or a named one. */
export interface DispatchPlace {
  branchId?: string | null;
  warehouseId?: string | null;
}

/** One movement out of (or back into) a warehouse, and the document it belongs to. */
export interface DispatchMovement {
  place?: DispatchPlace;
  type?: 'SALE_DISPATCH' | 'SALE_RETURN';
  reference: string;
  sourceType: string;
  sourceId: string | null;
}

/**
 * Goods leaving with a sales document, and coming back when it is undone — what Sales sees of the
 * stock ledger. Like `GoodsReceiptPort`, it takes the caller's manager: a conduce that recorded the
 * delivery but not the stock movement is the drift it exists to prevent.
 */
export abstract class StockDispatchPort {
  abstract decreaseStock(
    productId: string,
    quantity: number,
    manager: EntityManager,
    organizationId: string,
    movement: DispatchMovement,
  ): Promise<void>;

  abstract increaseStock(
    productId: string,
    quantity: number,
    manager: EntityManager,
    organizationId: string,
    movement: DispatchMovement,
  ): Promise<void>;
}
