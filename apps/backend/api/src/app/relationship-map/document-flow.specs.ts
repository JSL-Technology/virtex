import { FlowDocumentType, FlowStatusKind } from './contracts/document-flow.contracts';

/**
 * The declarative registry the whole module runs on.
 *
 * Adding a document type to the map is adding a `NodeSpec`; linking two types is adding an
 * `EdgeSpec`. Neither requires touching the engine, and neither imports the owning module — the
 * specs name tables and *entity property names*, and `DocumentFlowService` resolves those to real
 * column names at runtime from TypeORM's metadata, so the inconsistent physical naming of these
 * tables (`invoiceNumber` beside `customer_id` beside `quoteNumber`) never reaches the SQL by hand.
 */

/** How to read one document type as a node. Property names are resolved to columns at runtime. */
export interface NodeSpec {
  type: FlowDocumentType;
  /** Physical table name (these are stable and snake-cased; used verbatim, quoted). */
  table: string;
  typeKey: string;
  icon: string;
  /** Primary key property. Defaults to `id`. */
  idProp?: string;
  /** Tenant column property. Defaults to `organizationId`. */
  orgProp?: string;
  /** Property holding the human document number. Omitted = the type has no number. */
  numberProp?: string;
  /** Property holding the document date. */
  dateProp?: string;
  /** Property holding the status enum. */
  statusProp?: string;
  /** Property holding the document total. */
  totalProp?: string;
  /** Property holding the ISO currency code. */
  currencyProp?: string;
  /** A counterparty name frozen on this table (e.g. `customerName`). */
  partyNameProp?: string;
  /**
   * A counterparty resolved by join. `idColumn` is the raw FK *column* (relation join columns carry
   * no scalar property to resolve), `nameProp` is the entity property on the joined table.
   */
  partyJoin?: { idColumn: string; table: string; nameProp: string };
  /** Maps a discriminator property's value to a subtype badge i18n key (e.g. credit note). */
  subtype?: { prop: string; map: Record<string, string> };
  /** Raw status → normalised kind. A status absent here falls back to {@link classifyStatus}. */
  statusMap?: Record<string, FlowStatusKind>;
  /** Builds the client route (no org prefix) that opens the document, or null when there is none. */
  route?: (id: string) => string | null;
}

/**
 * How two document types are linked.
 *
 * `fk` — one table carries a foreign-key column pointing at the other. `fkRole` says whether the
 * row carrying the FK is the *source* (base) of the relationship or its *target* (derived), which
 * is what orients the arrow regardless of which end the traversal arrives from.
 *
 * `junction` — a line/link table carries both ids (an invoice paid by a receipt is recorded, one
 * row per application, in `customer_payment_lines`). `sourceSide` names the base end.
 */
export type EdgeSpec =
  | {
      kind: 'fk';
      fkTable: string;
      fkType: FlowDocumentType;
      fkProp: string;
      refType: FlowDocumentType;
      fkRole: 'source' | 'target';
      relationKey: string;
    }
  | {
      kind: 'junction';
      table: string;
      aProp: string;
      aType: FlowDocumentType;
      bProp: string;
      bType: FlowDocumentType;
      sourceSide: 'a' | 'b';
      relationKey: string;
    };

const T = FlowDocumentType;

/** Invoice statuses carry fiscal meaning, so they are mapped explicitly rather than guessed. */
const INVOICE_STATUS: Record<string, FlowStatusKind> = {
  Draft: 'draft',
  Pending: 'open',
  'Partially Paid': 'open',
  Paid: 'closed',
  Void: 'cancelled',
  'Credit Note': 'closed',
};

export const NODE_SPECS: Record<FlowDocumentType, NodeSpec> = {
  [T.SALES_QUOTE]: {
    type: T.SALES_QUOTE,
    table: 'quotes',
    typeKey: 'relationship_map.doc.sales_quote',
    icon: 'FileText',
    numberProp: 'quoteNumber',
    dateProp: 'issueDate',
    statusProp: 'status',
    totalProp: 'total',
    currencyProp: 'currencyCode',
    partyJoin: { idColumn: 'customer_id', table: 'customers', nameProp: 'companyName' },
    route: (id) => `quotes/${id}/edit`,
  },
  [T.SALES_INVOICE]: {
    type: T.SALES_INVOICE,
    table: 'invoices',
    typeKey: 'relationship_map.doc.sales_invoice',
    icon: 'Receipt',
    numberProp: 'invoiceNumber',
    dateProp: 'issueDate',
    statusProp: 'status',
    totalProp: 'total',
    currencyProp: 'currencyCode',
    partyNameProp: 'customerName',
    subtype: {
      prop: 'type',
      map: {
        CREDIT_NOTE: 'relationship_map.subtype.credit_note',
        DEBIT_NOTE: 'relationship_map.subtype.debit_note',
      },
    },
    statusMap: INVOICE_STATUS,
    route: (id) => `invoices/${id}`,
  },
  [T.CUSTOMER_PAYMENT]: {
    type: T.CUSTOMER_PAYMENT,
    table: 'customer_payments',
    typeKey: 'relationship_map.doc.customer_payment',
    icon: 'HandCoins',
    numberProp: 'receiptNumber',
    dateProp: 'paymentDate',
    statusProp: 'status',
    totalProp: 'totalAmount',
    currencyProp: 'currencyCode',
    partyJoin: { idColumn: 'customer_id', table: 'customers', nameProp: 'companyName' },
  },
  [T.POS_SALE]: {
    type: T.POS_SALE,
    table: 'pos_sales',
    typeKey: 'relationship_map.doc.pos_sale',
    icon: 'ShoppingCart',
    dateProp: 'createdAt',
    statusProp: 'status',
    totalProp: 'total',
    partyNameProp: 'customerName',
  },
  [T.ECF_SUBMISSION]: {
    type: T.ECF_SUBMISSION,
    table: 'ecf_submissions',
    typeKey: 'relationship_map.doc.ecf_submission',
    icon: 'FileCheck',
    numberProp: 'ncf',
    dateProp: 'sentAt',
    statusProp: 'status',
  },
  [T.PURCHASE_REQUISITION]: {
    type: T.PURCHASE_REQUISITION,
    table: 'purchase_requisitions',
    typeKey: 'relationship_map.doc.purchase_requisition',
    icon: 'ClipboardList',
    numberProp: 'number',
    dateProp: 'requiredDate',
    statusProp: 'status',
    totalProp: 'totalAmount',
    route: (id) => `purchasing/requisitions/${id}/edit`,
  },
  [T.PURCHASE_ORDER]: {
    type: T.PURCHASE_ORDER,
    table: 'purchase_orders',
    typeKey: 'relationship_map.doc.purchase_order',
    icon: 'ShoppingBag',
    numberProp: 'number',
    dateProp: 'orderDate',
    statusProp: 'status',
    totalProp: 'total',
    currencyProp: 'currencyCode',
    partyJoin: { idColumn: 'supplier_id', table: 'suppliers', nameProp: 'name' },
    route: (id) => `purchasing/orders/${id}/edit`,
  },
  [T.GOODS_RECEIPT]: {
    type: T.GOODS_RECEIPT,
    table: 'purchase_order_receipts',
    typeKey: 'relationship_map.doc.goods_receipt',
    icon: 'PackageCheck',
    numberProp: 'number',
    dateProp: 'receivedAt',
    statusProp: 'status',
    route: (id) => `purchasing/receipts/${id}`,
  },
  [T.VENDOR_BILL]: {
    type: T.VENDOR_BILL,
    table: 'vendor_bills',
    typeKey: 'relationship_map.doc.vendor_bill',
    icon: 'FileText',
    numberProp: 'ncf',
    dateProp: 'date',
    statusProp: 'status',
    totalProp: 'total',
    currencyProp: 'currencyCode',
    partyJoin: { idColumn: 'vendor_id', table: 'suppliers', nameProp: 'name' },
  },
  [T.JOURNAL_ENTRY]: {
    type: T.JOURNAL_ENTRY,
    table: 'journal_entries',
    typeKey: 'relationship_map.doc.journal_entry',
    icon: 'BookOpen',
    numberProp: 'entryNumber',
    dateProp: 'date',
    statusProp: 'status',
    currencyProp: 'currencyCode',
    route: (id) => `accounting/journal-entries/${id}/edit`,
  },
};

/**
 * Every business link the map can traverse, in both directions automatically.
 *
 * Read each as a sentence running base → derived: a quote is *invoiced*, an invoice is *posted* to
 * a journal entry and *settled by* a receipt, a requisition is *ordered*, an order is *received*
 * and *billed*. The engine walks these from either end.
 */
export const EDGE_SPECS: EdgeSpec[] = [
  // Sales
  { kind: 'fk', fkTable: 'quotes', fkType: T.SALES_QUOTE, fkProp: 'invoiceId', refType: T.SALES_INVOICE, fkRole: 'source', relationKey: 'relationship_map.rel.invoiced' },
  { kind: 'fk', fkTable: 'invoices', fkType: T.SALES_INVOICE, fkProp: 'originalInvoiceId', refType: T.SALES_INVOICE, fkRole: 'target', relationKey: 'relationship_map.rel.corrects' },
  { kind: 'fk', fkTable: 'pos_sales', fkType: T.POS_SALE, fkProp: 'invoiceId', refType: T.SALES_INVOICE, fkRole: 'source', relationKey: 'relationship_map.rel.invoiced' },
  { kind: 'fk', fkTable: 'ecf_submissions', fkType: T.ECF_SUBMISSION, fkProp: 'invoiceId', refType: T.SALES_INVOICE, fkRole: 'target', relationKey: 'relationship_map.rel.e_submitted' },
  { kind: 'junction', table: 'customer_payment_lines', aProp: 'invoiceId', aType: T.SALES_INVOICE, bProp: 'paymentId', bType: T.CUSTOMER_PAYMENT, sourceSide: 'a', relationKey: 'relationship_map.rel.settled_by' },

  // Procurement
  { kind: 'fk', fkTable: 'purchase_orders', fkType: T.PURCHASE_ORDER, fkProp: 'requisitionId', refType: T.PURCHASE_REQUISITION, fkRole: 'target', relationKey: 'relationship_map.rel.ordered' },
  { kind: 'fk', fkTable: 'purchase_order_receipts', fkType: T.GOODS_RECEIPT, fkProp: 'orderId', refType: T.PURCHASE_ORDER, fkRole: 'target', relationKey: 'relationship_map.rel.received' },
  { kind: 'fk', fkTable: 'vendor_bills', fkType: T.VENDOR_BILL, fkProp: 'purchaseOrderId', refType: T.PURCHASE_ORDER, fkRole: 'target', relationKey: 'relationship_map.rel.billed' },

  // Postings to the ledger (source document → journal entry)
  { kind: 'fk', fkTable: 'invoices', fkType: T.SALES_INVOICE, fkProp: 'journalEntryId', refType: T.JOURNAL_ENTRY, fkRole: 'source', relationKey: 'relationship_map.rel.posted' },
  { kind: 'fk', fkTable: 'invoices', fkType: T.SALES_INVOICE, fkProp: 'costJournalEntryId', refType: T.JOURNAL_ENTRY, fkRole: 'source', relationKey: 'relationship_map.rel.cost_posted' },
  { kind: 'fk', fkTable: 'customer_payments', fkType: T.CUSTOMER_PAYMENT, fkProp: 'journalEntryId', refType: T.JOURNAL_ENTRY, fkRole: 'source', relationKey: 'relationship_map.rel.posted' },
  { kind: 'fk', fkTable: 'purchase_order_receipts', fkType: T.GOODS_RECEIPT, fkProp: 'journalEntryId', refType: T.JOURNAL_ENTRY, fkRole: 'source', relationKey: 'relationship_map.rel.posted' },
  { kind: 'fk', fkTable: 'vendor_bills', fkType: T.VENDOR_BILL, fkProp: 'journalEntryId', refType: T.JOURNAL_ENTRY, fkRole: 'source', relationKey: 'relationship_map.rel.posted' },
];

/**
 * Fallback classifier for a status this module was not told about.
 *
 * Heuristic on purpose: the alternative is a second copy of every module's status enum, which drifts
 * the day one of them changes. Explicit maps (`NodeSpec.statusMap`) win where the exact wording
 * carries fiscal meaning; everything else is read by shape.
 */
export function classifyStatus(raw: string | null): FlowStatusKind {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase();
  if (/(draft|borrador|nuevo|new)/.test(s)) return 'draft';
  if (/(void|cancel|anul|reject|rechaz|fail|error|declin)/.test(s)) return 'cancelled';
  if (/(paid|pagad|closed|cerrad|accept|acept|post|contabiliz|received|recib|complete|complet|done|approved|aprobad|accepted)/.test(s)) return 'closed';
  return 'open';
}
