/**
 * What Accounts Payable announces about a supplier bill, after its transaction has committed
 * (`BUSINESS_EVENTS.VENDOR_BILL_POSTED` / `VENDOR_BILL_VOIDED`).
 *
 * Stock no longer moves on these: the goods enter and leave in the bill's own transaction, through
 * `GoodsReceiptPort` (AP-05). The events are for whoever reacts to the fact — the workflow engine
 * starts processes from them.
 */
export interface VendorBillEventLine {
  productId: string | null | undefined;
  quantity: number;
  /** Unit cost in the books' currency. */
  unitCost?: number;
  reference?: string;
}

export interface VendorBillPostedEvent {
  billId: string;
  organizationId: string;
  journalEntryId: string;
  branchId?: string | null;
  /** The lines whose goods the bill itself brought into stock. */
  lines: VendorBillEventLine[];
}

export interface VendorBillVoidedEvent {
  billId: string;
  organizationId: string;
  reason: string;
  actorUserId: string;
  reversalJournalEntryId: string | null | undefined;
  branchId?: string | null;
  /** The lines whose goods went back out. */
  lines: VendorBillEventLine[];
  /** True when the bill had reached OPEN or PARTIALLY_PAID before being voided. */
  wasPosted: boolean;
}
