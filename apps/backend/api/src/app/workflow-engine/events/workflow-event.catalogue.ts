import { BUSINESS_EVENTS } from '../../contracts/business-events/business-events.contract';
import { WorkflowSubject, WorkflowVariable } from '../contracts/workflow-graph';

/** What an event contributes to a new instance: its context, what it is about, and who caused it. */
export interface WorkflowEventStart {
  context: Record<string, unknown>;
  subject: WorkflowSubject | null;
  actorUserId: string | null;
}

export interface WorkflowEventDefinition {
  key: string;
  /** The functional area, for grouping in the designer (`sales`, `purchasing`, …). */
  group: 'sales' | 'purchasing' | 'accounting' | 'approvals' | 'customers' | 'integration';
  /** The variables an instance started by this event receives — the designer offers them. */
  fields: WorkflowVariable[];
  map(payload: Record<string, unknown>): WorkflowEventStart;
}

/** Events an integration may fire through the API without a domain module behind them. */
export const CUSTOM_EVENT_PREFIX = 'custom.';
const CUSTOM_EVENT = /^custom\.[a-z0-9][a-z0-9_.-]{0,100}$/;

const str = (value: unknown): string | null => (value === undefined || value === null ? null : String(value));
const num = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const actor = (payload: Record<string, unknown>): string | null => str(payload['actorUserId']);

const field = (name: string, type: WorkflowVariable['type']): WorkflowVariable => ({
  name,
  type,
  label: `workflow_engine.event_field.${name}`,
});

function invoiceStart(payload: Record<string, unknown>): WorkflowEventStart {
  const customer = obj(payload['customer']);
  const id = str(payload['invoiceId'] ?? payload['id']);
  const number = str(payload['invoiceNumber']);
  return {
    context: {
      invoiceId: id,
      invoiceNumber: number,
      status: str(payload['status']),
      total: num(payload['total']),
      balance: num(payload['balance']),
      currencyCode: str(payload['currencyCode']),
      customerId: str(payload['customerId'] ?? customer['id']),
      customerName: str(payload['customerName'] ?? customer['companyName']),
      dueDate: str(payload['dueDate']),
    },
    subject: id ? { type: 'invoice', id, label: number ?? id.slice(0, 8), route: `/invoices/${id}` } : null,
    actorUserId: actor(payload),
  };
}

function quoteStart(payload: Record<string, unknown>): WorkflowEventStart {
  const id = str(payload['quoteId']);
  const number = str(payload['quoteNumber']);
  return {
    context: {
      quoteId: id,
      quoteNumber: number,
      status: str(payload['status']),
      total: num(payload['total']),
      currencyCode: str(payload['currencyCode']),
      customerId: str(payload['customerId']),
      customerName: str(payload['customerName']),
      reason: str(payload['reason']),
    },
    subject: id ? { type: 'quote', id, label: number ?? id.slice(0, 8), route: `/quotes/${id}/edit` } : null,
    actorUserId: actor(payload),
  };
}

const INVOICE_FIELDS = [
  field('invoiceId', 'string'),
  field('invoiceNumber', 'string'),
  field('status', 'string'),
  field('total', 'number'),
  field('balance', 'number'),
  field('currencyCode', 'string'),
  field('customerId', 'string'),
  field('customerName', 'string'),
  field('dueDate', 'date'),
];

const QUOTE_FIELDS = [
  field('quoteId', 'string'),
  field('quoteNumber', 'string'),
  field('status', 'string'),
  field('total', 'number'),
  field('currencyCode', 'string'),
  field('customerId', 'string'),
  field('customerName', 'string'),
];

/**
 * Every business event a process can be started from, with how its payload becomes an instance.
 *
 * Each mapper is explicit about what it copies: a payload can be a whole entity with relations and
 * internal columns, and only the business fields a process should reason about cross into the
 * instance context (which is visible to anyone who can read the run). The fields list is what the
 * designer offers in its variable pickers for a process subscribed to that event.
 */
export const WORKFLOW_EVENT_CATALOGUE: readonly WorkflowEventDefinition[] = [
  { key: BUSINESS_EVENTS.INVOICE_CREATED, group: 'sales', fields: INVOICE_FIELDS, map: invoiceStart },
  { key: BUSINESS_EVENTS.INVOICE_ISSUED, group: 'sales', fields: INVOICE_FIELDS, map: invoiceStart },
  {
    key: BUSINESS_EVENTS.CREDIT_NOTE_CREATED,
    group: 'sales',
    fields: [field('creditNoteId', 'string'), field('creditNoteNumber', 'string'), field('invoiceId', 'string'), field('invoiceNumber', 'string'), field('total', 'number'), field('customerName', 'string')],
    map: (payload) => {
      const note = obj(payload['creditNote']);
      const original = obj(payload['originalInvoice']);
      const id = str(note['id']);
      return {
        context: {
          creditNoteId: id,
          creditNoteNumber: str(note['invoiceNumber']),
          invoiceId: str(original['id']),
          invoiceNumber: str(original['invoiceNumber']),
          total: num(note['total']),
          customerName: str(obj(note['customer'])['companyName']),
        },
        subject: id ? { type: 'credit_note', id, label: str(note['invoiceNumber']) ?? id.slice(0, 8), route: `/invoices/${id}` } : null,
        actorUserId: actor(payload),
      };
    },
  },
  { key: BUSINESS_EVENTS.QUOTE_CREATED, group: 'sales', fields: QUOTE_FIELDS, map: quoteStart },
  { key: BUSINESS_EVENTS.QUOTE_ACCEPTED, group: 'sales', fields: QUOTE_FIELDS, map: quoteStart },
  { key: BUSINESS_EVENTS.QUOTE_REJECTED, group: 'sales', fields: [...QUOTE_FIELDS, field('reason', 'string')], map: quoteStart },
  {
    key: BUSINESS_EVENTS.CUSTOMER_CREATED,
    group: 'customers',
    fields: [field('customerId', 'string'), field('customerName', 'string'), field('email', 'string'), field('country', 'string')],
    map: (payload) => {
      const id = str(payload['customerId']);
      return {
        context: { customerId: id, customerName: str(payload['customerName']), email: str(payload['email']), country: str(payload['country']) },
        subject: id ? { type: 'customer', id, label: str(payload['customerName']) ?? id.slice(0, 8), route: `/contacts/customers/${id}/edit` } : null,
        actorUserId: actor(payload),
      };
    },
  },
  {
    key: BUSINESS_EVENTS.CUSTOMER_PAYMENT_RECEIVED,
    group: 'customers',
    fields: [field('paymentId', 'string'), field('receiptNumber', 'string'), field('total', 'number'), field('currencyCode', 'string'), field('customerId', 'string')],
    map: (payload) => {
      const id = str(payload['paymentId']);
      return {
        context: {
          paymentId: id,
          receiptNumber: str(payload['receiptNumber']),
          total: num(payload['total']),
          currencyCode: str(payload['currencyCode']),
          customerId: str(payload['customerId']),
        },
        subject: id ? { type: 'customer_payment', id, label: str(payload['receiptNumber']) ?? id.slice(0, 8), route: `/customer-receipts` } : null,
        actorUserId: actor(payload),
      };
    },
  },
  {
    key: BUSINESS_EVENTS.PURCHASE_ORDER_CREATED,
    group: 'purchasing',
    fields: [field('purchaseOrderId', 'string'), field('number', 'string'), field('total', 'number'), field('currencyCode', 'string'), field('supplierId', 'string'), field('supplierName', 'string')],
    map: (payload) => {
      const id = str(payload['purchaseOrderId']);
      return {
        context: {
          purchaseOrderId: id,
          number: str(payload['number']),
          total: num(payload['total']),
          currencyCode: str(payload['currencyCode']),
          supplierId: str(payload['supplierId']),
          supplierName: str(payload['supplierName']),
        },
        subject: id ? { type: 'purchase_order', id, label: str(payload['number']) ?? id.slice(0, 8), route: `/purchasing/orders/${id}/edit` } : null,
        actorUserId: actor(payload),
      };
    },
  },
  {
    key: BUSINESS_EVENTS.GOODS_RECEIPT_CREATED,
    group: 'purchasing',
    fields: [field('receiptId', 'string'), field('number', 'string'), field('purchaseOrderNumber', 'string'), field('supplierName', 'string')],
    map: (payload) => {
      const id = str(payload['receiptId']);
      return {
        context: {
          receiptId: id,
          number: str(payload['number']),
          purchaseOrderId: str(payload['purchaseOrderId']),
          purchaseOrderNumber: str(payload['purchaseOrderNumber']),
          supplierName: str(payload['supplierName']),
        },
        subject: id ? { type: 'goods_receipt', id, label: str(payload['number']) ?? id.slice(0, 8), route: `/purchasing/receipts/${id}` } : null,
        actorUserId: actor(payload),
      };
    },
  },
  {
    key: BUSINESS_EVENTS.VENDOR_BILL_POSTED,
    group: 'purchasing',
    fields: [field('billId', 'string'), field('journalEntryId', 'string')],
    map: (payload) => {
      const id = str(payload['billId']);
      return {
        context: { billId: id, journalEntryId: str(payload['journalEntryId']) },
        subject: id ? { type: 'vendor_bill', id, label: id.slice(0, 8), route: `/accounts-payable/${id}` } : null,
        actorUserId: actor(payload),
      };
    },
  },
  {
    key: BUSINESS_EVENTS.VENDOR_BILL_VOIDED,
    group: 'purchasing',
    fields: [field('billId', 'string')],
    map: (payload) => {
      const id = str(payload['billId']);
      return {
        context: { billId: id },
        subject: id ? { type: 'vendor_bill', id, label: id.slice(0, 8), route: `/accounts-payable/${id}` } : null,
        actorUserId: actor(payload),
      };
    },
  },
  {
    key: BUSINESS_EVENTS.JOURNAL_ENTRY_POSTED,
    group: 'accounting',
    fields: [field('entryId', 'string')],
    map: (payload) => {
      const id = str(payload['entryId']);
      return {
        context: { entryId: id },
        subject: id ? { type: 'journal_entry', id, label: id.slice(0, 8), route: `/journal-entries/${id}/edit` } : null,
        actorUserId: actor(payload),
      };
    },
  },
  {
    key: BUSINESS_EVENTS.APPROVAL_REQUESTED,
    group: 'approvals',
    fields: [field('requestId', 'string'), field('documentType', 'string'), field('documentId', 'string'), field('amount', 'number'), field('currencyCode', 'string'), field('reference', 'string')],
    map: (payload) => ({
      context: {
        requestId: str(payload['requestId']),
        documentType: str(payload['documentType']),
        documentId: str(payload['documentId']),
        amount: num(payload['amount']),
        currencyCode: str(payload['currencyCode']),
        reference: str(payload['reference']),
      },
      subject: { type: 'approval_request', id: str(payload['requestId']) ?? undefined, label: str(payload['reference']) ?? str(payload['documentType']) ?? undefined, route: '/approvals' },
      actorUserId: str(payload['requestedByUserId']),
    }),
  },
  {
    key: BUSINESS_EVENTS.APPROVAL_DECIDED,
    group: 'approvals',
    fields: [field('requestId', 'string'), field('documentType', 'string'), field('documentId', 'string'), field('decision', 'string'), field('reason', 'string'), field('reference', 'string')],
    map: (payload) => ({
      context: {
        requestId: str(payload['requestId']),
        documentType: str(payload['documentType']),
        documentId: str(payload['documentId']),
        decision: str(payload['decision']),
        reason: str(payload['reason']),
        reference: str(payload['reference']),
      },
      subject: { type: 'approval_request', id: str(payload['requestId']) ?? undefined, label: str(payload['reference']) ?? str(payload['documentType']) ?? undefined, route: '/approvals' },
      actorUserId: str(payload['actorUserId']),
    }),
  },
];

const BY_KEY = new Map(WORKFLOW_EVENT_CATALOGUE.map((definition) => [definition.key, definition]));

export function eventDefinition(key: string): WorkflowEventDefinition | undefined {
  return BY_KEY.get(key);
}

/** A catalogued business event, or a well-formed `custom.*` integration event. */
export function isKnownWorkflowEvent(key: string): boolean {
  return BY_KEY.has(key) || CUSTOM_EVENT.test(key);
}
