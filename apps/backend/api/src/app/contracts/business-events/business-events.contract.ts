/**
 * The business facts the domain modules announce, by name.
 *
 * A module that does something worth reacting to (a quote accepted, a customer registered) emits
 * one of these through the application's event bus, after its transaction has committed. Anyone may
 * listen — the workflow engine starts processes from them — and nobody has to import the module that
 * emitted it, which is the point: the name and the payload's minimum shape are the whole contract.
 *
 * Every payload carries `organizationId`, because a listener runs outside the request that caused it
 * and must know which company's row-level context to act in.
 */
export const BUSINESS_EVENTS = {
  INVOICE_CREATED: 'invoice.created',
  INVOICE_ISSUED: 'invoice.issued',
  CREDIT_NOTE_CREATED: 'invoice.credit-note-created',
  QUOTE_CREATED: 'quote.created',
  QUOTE_ACCEPTED: 'quote.accepted',
  QUOTE_REJECTED: 'quote.rejected',
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_PAYMENT_RECEIVED: 'customer-payment.received',
  PURCHASE_ORDER_CREATED: 'purchase-order.created',
  GOODS_RECEIPT_CREATED: 'goods-receipt.created',
  VENDOR_BILL_POSTED: 'vendor.bill.posted',
  VENDOR_BILL_VOIDED: 'vendor.bill.voided',
  JOURNAL_ENTRY_POSTED: 'journal-entry.posted',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_DECIDED: 'approval.decided',
} as const;

export type BusinessEventName = (typeof BUSINESS_EVENTS)[keyof typeof BUSINESS_EVENTS];

/** The minimum every business event payload carries. */
export interface BusinessEventPayload {
  organizationId: string;
  /** Who caused it, when there is a person behind it. */
  actorUserId?: string | null;
  [field: string]: unknown;
}
