import {
  FlowDocumentType,
  FlowModule,
  FlowRelationCategory,
  FlowStatusKind,
} from './contracts/document-flow.contracts';

/**
 * The declarative registry the whole module runs on.
 *
 * Adding a document type to the map is adding a `NodeSpec`; linking two types is adding an
 * `EdgeSpec`. Neither touches the engine, and neither imports the owning module: the specs name
 * *entities* and *entity properties* as strings, and `DocumentFlowCatalog` resolves them to real
 * tables and columns from TypeORM's runtime metadata — so the inconsistent physical naming of
 * these tables (`invoiceNumber` beside `customer_id` beside `vendor_payment`) never reaches the SQL
 * by hand, and a renamed column is reported at start-up instead of failing a user's request.
 *
 * `document-flow.specs.spec.ts` checks every name here against the real entities.
 */

/** A value read from a joined row: `via` is the FK property on the document, `prop` is on `entity`. */
export interface LookupJoin {
  via: string;
  entity: string;
  prop: string;
}

/** A total computed from child rows (a payment batch has no total column of its own). */
export interface AggregateTotal {
  /** Child entity. */
  entity: string;
  /** Property on the child pointing back at the document. */
  fkProp: string;
  /** Property on the child to sum. */
  sumProp: string;
}

/** How to read one document type as a node. */
export interface NodeSpec {
  type: FlowDocumentType;
  /** TypeORM entity name (the class name). Resolved to its table at start-up. */
  entity: string;
  module: FlowModule;
  typeKey: string;
  /**
   * The permission that lets someone read this document on its own screen. Without it, the map
   * still shows the node (so the chain keeps its shape) but withholds every identifying field.
   */
  permission: string;
  /** Tenant column properties. Defaults to `['organizationId']`; several = the row belongs to either. */
  orgProps?: string[];
  numberProp?: string;
  dateProp?: string;
  statusProp?: string;
  totalProp?: string;
  totalAggregate?: AggregateTotal;
  currencyProp?: string;
  currencyLookup?: LookupJoin;
  partyNameProp?: string;
  partyLookup?: LookupJoin;
  descriptionProp?: string;
  subtype?: { prop: string; map: Record<string, string> };
  /**
   * Raw status → kind. Explicit and exhaustive for the type's enum; `document-flow.specs.spec.ts`
   * holds the list of values each enum has, so a new status cannot slip through uncoloured.
   */
  statusMap?: Record<string, FlowStatusKind>;
  /** Kind for a value missing from `statusMap`, or for a type with no status at all. Default `unknown`. */
  statusFallback?: FlowStatusKind;
  /**
   * Catalogue prefix of the document's own status labels (`invoices.status` + `paid`). The raw
   * value is lower-cased with spaces as underscores, as the document's screens name it.
   */
  statusLabelPrefix?: string;
  /**
   * A hub collects links from many unrelated documents — a journal entry can be shared by a whole
   * payment batch, a depreciation run by every asset. When the map *passes through* a hub it does
   * not fan back out of it into other documents (only into other hubs: a reversal of the entry),
   * or one invoice's map would grow every other document the same entry touched. Opened *on* a
   * hub, the map expands from it normally: from a journal entry you want its source document.
   */
  hub?: boolean;
  /** The number can be searched for from the picker. Needs `numberProp`. */
  searchable?: boolean;
  /**
   * The description is a second number people search by — an invoice's e-NCF. Searching
   * «B0100000001» found nothing while «FAC-00000001» did (QA R3-M13).
   */
  searchDescription?: boolean;
}

/**
 * How two document types are linked.
 *
 * `fk` — the `carrier` type's entity has a property (`prop`) holding the id of a `target` document.
 * `carrierRole` says whether the carrier is the *source* (base) of the relationship or its *target*
 * (derived), which orients the arrow regardless of which end the traversal arrives from.
 *
 * `junction` — a line/link entity carries both ids (an invoice paid by a receipt is recorded, one
 * row per application, in `customer_payment_lines`). `sourceSide` names the base end. `tenantSide`
 * names the side whose document table the junction is tenant-filtered through when the junction
 * has no tenant column of its own.
 */
export type EdgeSpec =
  | {
      kind: 'fk';
      carrier: FlowDocumentType;
      prop: string;
      target: FlowDocumentType;
      carrierRole: 'source' | 'target';
      relation: string;
      category: FlowRelationCategory;
    }
  | {
      kind: 'junction';
      entity: string;
      aProp: string;
      aType: FlowDocumentType;
      bProp: string;
      bType: FlowDocumentType;
      sourceSide: 'a' | 'b';
      tenantSide: 'a' | 'b';
      relation: string;
      category: FlowRelationCategory;
    };

const T = FlowDocumentType;
const P = {
  INVOICES: 'invoices:view',
  CRM: 'crm:view',
  AR: 'accounts_receivable:view',
  AP: 'accounts_payable:view',
  POS: 'pos:view',
  PROCUREMENT: 'procurement:view',
  JOURNAL: 'journal_entries:view',
  TREASURY: 'treasury:view',
  INTERCOMPANY: 'intercompany:view',
  STOCK: 'inventory:view_stock',
  PAYROLL: 'payroll:view',
  ASSETS: 'fixed_assets:view',
} as const;

// ── Status maps, one per enum. Exhaustive: see document-flow.specs.spec.ts ─────────────────────

export const STATUS_MAPS = {
  quote: { DRAFT: 'draft', SENT: 'open', ACCEPTED: 'open', REJECTED: 'cancelled', INVOICED: 'closed', CANCELLED: 'cancelled' },
  invoice: { Draft: 'draft', Pending: 'open', 'Partially Paid': 'open', Paid: 'closed', Void: 'cancelled', 'Credit Note': 'closed' },
  customerPayment: { POSTED: 'closed', VOID: 'cancelled' },
  posSale: { PAID: 'closed', CANCELLED: 'cancelled' },
  ecf: {
    PENDING: 'pending',
    SIGNED: 'pending',
    SENT: 'pending',
    ACCEPTED: 'closed',
    ACCEPTED_WITH_OBSERVATIONS: 'closed',
    REJECTED: 'cancelled',
    CONTINGENCY: 'pending',
    ERROR: 'pending',
  },
  requisition: { DRAFT: 'draft', PENDING_APPROVAL: 'pending', APPROVED: 'open', REJECTED: 'cancelled', CONVERTED_TO_PO: 'closed' },
  purchaseOrder: {
    DRAFT: 'draft',
    PENDING_APPROVAL: 'pending',
    APPROVED: 'open',
    SENT: 'open',
    PARTIALLY_RECEIVED: 'open',
    RECEIVED: 'closed',
    CANCELLED: 'cancelled',
  },
  goodsReceipt: { POSTED: 'closed', VOID: 'cancelled' },
  vendorBill: {
    DRAFT: 'draft',
    PENDING_APPROVAL: 'pending',
    OPEN: 'open',
    PARTIALLY_PAID: 'open',
    PAID: 'closed',
    VOID: 'cancelled',
    REJECTED: 'cancelled',
  },
  vendorDebitNote: { POSTED: 'closed', VOIDED: 'cancelled' },
  paymentBatch: { PENDING: 'pending', PROCESSING: 'pending', PAID: 'closed', VOID: 'cancelled' },
  // `Modified`: superseded by the entry that corrected it — no longer the effective record.
  journalEntry: { Draft: 'draft', 'Pending Approval': 'pending', Posted: 'closed', Modified: 'cancelled', Void: 'cancelled', Rejected: 'cancelled' },
  inventoryAdjustment: { DRAFT: 'draft', POSTED: 'closed', CANCELLED: 'cancelled' },
  payrollRun: { DRAFT: 'draft', CALCULATED: 'pending', APPROVED: 'open', PAID: 'closed', CANCELLED: 'cancelled' },
  intercompany: { PENDING: 'pending', PROCESSING: 'pending', COMPLETED: 'closed', FAILED: 'cancelled' },
  fixedAsset: { IN_USE: 'open', DISPOSED: 'closed', SOLD: 'closed' },
  // Free-text pipeline stage: only the two terminal ones are known; anything else is still open.
  opportunity: { CLOSED_WON: 'closed', WON: 'closed', CLOSED_LOST: 'cancelled', LOST: 'cancelled' },
} satisfies Record<string, Record<string, FlowStatusKind>>;

const ON_CUSTOMER: LookupJoin = { via: 'customer', entity: 'Customer', prop: 'companyName' };

export const NODE_SPECS: Record<FlowDocumentType, NodeSpec> = {
  // ── Ventas ────────────────────────────────────────────────────────────────────────────────────
  [T.SALES_OPPORTUNITY]: {
    type: T.SALES_OPPORTUNITY,
    entity: 'Opportunity',
    module: 'sales',
    typeKey: 'relationship_map.doc.sales_opportunity',
    permission: P.CRM,
    descriptionProp: 'name',
    statusProp: 'stage',
    totalProp: 'amount',
    partyLookup: ON_CUSTOMER,
    statusMap: STATUS_MAPS.opportunity,
    statusFallback: 'open',
  },
  [T.SALES_QUOTE]: {
    type: T.SALES_QUOTE,
    entity: 'Quote',
    module: 'sales',
    typeKey: 'relationship_map.doc.sales_quote',
    permission: P.INVOICES,
    numberProp: 'quoteNumber',
    dateProp: 'issueDate',
    statusProp: 'status',
    totalProp: 'total',
    currencyProp: 'currencyCode',
    partyLookup: ON_CUSTOMER,
    descriptionProp: 'notes',
    statusMap: STATUS_MAPS.quote,
    searchable: true,
  },
  [T.SALES_INVOICE]: {
    type: T.SALES_INVOICE,
    entity: 'Invoice',
    module: 'sales',
    typeKey: 'relationship_map.doc.sales_invoice',
    permission: P.INVOICES,
    numberProp: 'invoiceNumber',
    dateProp: 'issueDate',
    statusProp: 'status',
    totalProp: 'total',
    currencyProp: 'currencyCode',
    partyNameProp: 'customerName',
    descriptionProp: 'fiscalNumber',
    subtype: {
      prop: 'type',
      map: {
        CREDIT_NOTE: 'relationship_map.subtype.credit_note',
        DEBIT_NOTE: 'relationship_map.subtype.debit_note',
      },
    },
    statusMap: STATUS_MAPS.invoice,
    statusLabelPrefix: 'invoices.status',
    searchable: true,
    searchDescription: true,
  },
  [T.CUSTOMER_PAYMENT]: {
    type: T.CUSTOMER_PAYMENT,
    entity: 'CustomerPayment',
    module: 'sales',
    typeKey: 'relationship_map.doc.customer_payment',
    permission: P.AR,
    numberProp: 'receiptNumber',
    dateProp: 'paymentDate',
    statusProp: 'status',
    totalProp: 'totalAmount',
    currencyProp: 'currencyCode',
    partyLookup: ON_CUSTOMER,
    descriptionProp: 'reference',
    statusMap: STATUS_MAPS.customerPayment,
    searchable: true,
  },
  [T.POS_SALE]: {
    type: T.POS_SALE,
    entity: 'PosSale',
    module: 'sales',
    typeKey: 'relationship_map.doc.pos_sale',
    permission: P.POS,
    dateProp: 'createdAt',
    statusProp: 'status',
    totalProp: 'total',
    partyNameProp: 'customerName',
    statusMap: STATUS_MAPS.posSale,
  },
  [T.ECF_SUBMISSION]: {
    type: T.ECF_SUBMISSION,
    entity: 'EcfSubmission',
    module: 'sales',
    typeKey: 'relationship_map.doc.ecf_submission',
    permission: P.INVOICES,
    numberProp: 'ncf',
    dateProp: 'sentAt',
    statusProp: 'status',
    statusMap: STATUS_MAPS.ecf,
    searchable: true,
  },

  // ── Compras ───────────────────────────────────────────────────────────────────────────────────
  [T.PURCHASE_REQUISITION]: {
    type: T.PURCHASE_REQUISITION,
    entity: 'PurchaseRequisition',
    module: 'purchasing',
    typeKey: 'relationship_map.doc.purchase_requisition',
    permission: P.PROCUREMENT,
    numberProp: 'number',
    dateProp: 'requiredDate',
    statusProp: 'status',
    totalProp: 'totalAmount',
    statusMap: STATUS_MAPS.requisition,
    searchable: true,
  },
  [T.PURCHASE_ORDER]: {
    type: T.PURCHASE_ORDER,
    entity: 'PurchaseOrder',
    module: 'purchasing',
    typeKey: 'relationship_map.doc.purchase_order',
    permission: P.PROCUREMENT,
    numberProp: 'number',
    dateProp: 'orderDate',
    statusProp: 'status',
    totalProp: 'total',
    currencyProp: 'currencyCode',
    partyLookup: { via: 'supplier', entity: 'Supplier', prop: 'name' },
    statusMap: STATUS_MAPS.purchaseOrder,
    searchable: true,
  },
  [T.GOODS_RECEIPT]: {
    type: T.GOODS_RECEIPT,
    entity: 'PurchaseOrderReceipt',
    module: 'purchasing',
    typeKey: 'relationship_map.doc.goods_receipt',
    permission: P.PROCUREMENT,
    numberProp: 'number',
    dateProp: 'receivedAt',
    statusProp: 'status',
    statusMap: STATUS_MAPS.goodsReceipt,
    searchable: true,
  },
  [T.VENDOR_BILL]: {
    type: T.VENDOR_BILL,
    entity: 'VendorBill',
    module: 'purchasing',
    typeKey: 'relationship_map.doc.vendor_bill',
    permission: P.AP,
    numberProp: 'ncf',
    dateProp: 'date',
    statusProp: 'status',
    totalProp: 'total',
    currencyProp: 'currencyCode',
    partyLookup: { via: 'vendor', entity: 'Supplier', prop: 'name' },
    statusMap: STATUS_MAPS.vendorBill,
    searchable: true,
  },
  [T.VENDOR_DEBIT_NOTE]: {
    type: T.VENDOR_DEBIT_NOTE,
    entity: 'VendorDebitNote',
    module: 'purchasing',
    typeKey: 'relationship_map.doc.vendor_debit_note',
    permission: P.AP,
    numberProp: 'number',
    dateProp: 'date',
    statusProp: 'status',
    totalProp: 'amount',
    descriptionProp: 'reason',
    statusMap: STATUS_MAPS.vendorDebitNote,
    searchable: true,
  },
  [T.VENDOR_PAYMENT]: {
    type: T.VENDOR_PAYMENT,
    entity: 'PaymentBatch',
    module: 'purchasing',
    typeKey: 'relationship_map.doc.vendor_payment',
    permission: P.AP,
    numberProp: 'number',
    dateProp: 'paymentDate',
    statusProp: 'status',
    totalAggregate: { entity: 'VendorPayment', fkProp: 'paymentBatchId', sumProp: 'amount' },
    currencyLookup: { via: 'bankAccount', entity: 'BankAccount', prop: 'currencyCode' },
    descriptionProp: 'reference',
    statusMap: STATUS_MAPS.paymentBatch,
    searchable: true,
  },

  // ── Finanzas ──────────────────────────────────────────────────────────────────────────────────
  [T.JOURNAL_ENTRY]: {
    type: T.JOURNAL_ENTRY,
    entity: 'JournalEntry',
    module: 'finance',
    typeKey: 'relationship_map.doc.journal_entry',
    permission: P.JOURNAL,
    numberProp: 'entryNumber',
    dateProp: 'date',
    statusProp: 'status',
    totalAggregate: { entity: 'JournalEntryLine', fkProp: 'journalEntryId', sumProp: 'debit' },
    currencyProp: 'currencyCode',
    descriptionProp: 'description',
    statusMap: STATUS_MAPS.journalEntry,
    hub: true,
    searchable: true,
  },
  [T.BANK_TRANSFER]: {
    type: T.BANK_TRANSFER,
    entity: 'BankTransfer',
    module: 'finance',
    typeKey: 'relationship_map.doc.bank_transfer',
    permission: P.TREASURY,
    numberProp: 'reference',
    dateProp: 'date',
    totalProp: 'amount',
    currencyLookup: { via: 'fromBankAccount', entity: 'BankAccount', prop: 'currencyCode' },
    descriptionProp: 'description',
    // A transfer is recorded and posted in one act; it has no lifecycle of its own.
    statusFallback: 'closed',
  },
  [T.INTERCOMPANY_TRANSACTION]: {
    type: T.INTERCOMPANY_TRANSACTION,
    entity: 'IntercompanyTransaction',
    module: 'finance',
    typeKey: 'relationship_map.doc.intercompany_transaction',
    permission: P.INTERCOMPANY,
    // Both companies see the transaction; each sees only its own journal entry.
    orgProps: ['fromOrganizationId', 'toOrganizationId'],
    dateProp: 'transactionDate',
    statusProp: 'status',
    totalProp: 'amount',
    currencyProp: 'currencyCode',
    descriptionProp: 'description',
    statusMap: STATUS_MAPS.intercompany,
  },

  // ── Inventario ────────────────────────────────────────────────────────────────────────────────
  [T.INVENTORY_ADJUSTMENT]: {
    type: T.INVENTORY_ADJUSTMENT,
    entity: 'InventoryAdjustment',
    module: 'inventory',
    typeKey: 'relationship_map.doc.inventory_adjustment',
    permission: P.STOCK,
    numberProp: 'number',
    dateProp: 'date',
    statusProp: 'status',
    totalProp: 'valueChange',
    descriptionProp: 'notes',
    statusMap: STATUS_MAPS.inventoryAdjustment,
    searchable: true,
  },

  // ── RR.HH. ────────────────────────────────────────────────────────────────────────────────────
  [T.PAYROLL_RUN]: {
    type: T.PAYROLL_RUN,
    entity: 'PayrollRun',
    module: 'hr',
    typeKey: 'relationship_map.doc.payroll_run',
    permission: P.PAYROLL,
    numberProp: 'name',
    dateProp: 'payDate',
    statusProp: 'status',
    totalProp: 'totalNet',
    currencyProp: 'currencyCode',
    statusMap: STATUS_MAPS.payrollRun,
    searchable: true,
  },

  // ── Activos ───────────────────────────────────────────────────────────────────────────────────
  [T.FIXED_ASSET]: {
    type: T.FIXED_ASSET,
    entity: 'FixedAsset',
    module: 'assets',
    typeKey: 'relationship_map.doc.fixed_asset',
    permission: P.ASSETS,
    numberProp: 'number',
    dateProp: 'acquisitionDate',
    statusProp: 'status',
    totalProp: 'cost',
    descriptionProp: 'name',
    statusMap: STATUS_MAPS.fixedAsset,
    searchable: true,
  },
};

/**
 * Every business link the map can traverse, in both directions automatically.
 *
 * Read each as a sentence running base → derived: an opportunity is *quoted*, a quote is
 * *invoiced*, an invoice is *posted* and *settled by* a receipt, a requisition is *ordered*, an
 * order is *received* and *billed*, a bill is *settled by* a payment and *adjusted by* a debit note.
 */
export const EDGE_SPECS: EdgeSpec[] = [
  // ── Ventas ──
  { kind: 'fk', carrier: T.SALES_QUOTE, prop: 'opportunity', target: T.SALES_OPPORTUNITY, carrierRole: 'target', relation: 'quoted', category: 'flow' },
  { kind: 'fk', carrier: T.SALES_QUOTE, prop: 'invoiceId', target: T.SALES_INVOICE, carrierRole: 'source', relation: 'invoiced', category: 'flow' },
  { kind: 'fk', carrier: T.POS_SALE, prop: 'invoiceId', target: T.SALES_INVOICE, carrierRole: 'source', relation: 'invoiced', category: 'flow' },
  { kind: 'fk', carrier: T.SALES_INVOICE, prop: 'originalInvoiceId', target: T.SALES_INVOICE, carrierRole: 'target', relation: 'corrects', category: 'correction' },
  { kind: 'fk', carrier: T.ECF_SUBMISSION, prop: 'invoiceId', target: T.SALES_INVOICE, carrierRole: 'target', relation: 'e_submitted', category: 'fiscal' },
  { kind: 'junction', entity: 'CustomerPaymentLine', aProp: 'invoiceId', aType: T.SALES_INVOICE, bProp: 'paymentId', bType: T.CUSTOMER_PAYMENT, sourceSide: 'a', tenantSide: 'b', relation: 'settled_by', category: 'settlement' },

  // ── Compras ──
  { kind: 'fk', carrier: T.PURCHASE_ORDER, prop: 'requisitionId', target: T.PURCHASE_REQUISITION, carrierRole: 'target', relation: 'ordered', category: 'flow' },
  { kind: 'fk', carrier: T.PURCHASE_REQUISITION, prop: 'purchaseOrderId', target: T.PURCHASE_ORDER, carrierRole: 'source', relation: 'ordered', category: 'flow' },
  { kind: 'fk', carrier: T.GOODS_RECEIPT, prop: 'orderId', target: T.PURCHASE_ORDER, carrierRole: 'target', relation: 'received', category: 'flow' },
  { kind: 'fk', carrier: T.VENDOR_BILL, prop: 'purchaseOrderId', target: T.PURCHASE_ORDER, carrierRole: 'target', relation: 'billed', category: 'flow' },
  { kind: 'fk', carrier: T.VENDOR_DEBIT_NOTE, prop: 'vendorBillId', target: T.VENDOR_BILL, carrierRole: 'target', relation: 'adjusted_by', category: 'correction' },
  { kind: 'junction', entity: 'VendorPayment', aProp: 'vendorBillId', aType: T.VENDOR_BILL, bProp: 'paymentBatchId', bType: T.VENDOR_PAYMENT, sourceSide: 'a', tenantSide: 'b', relation: 'settled_by', category: 'settlement' },

  // ── Nómina ──
  { kind: 'fk', carrier: T.PAYROLL_RUN, prop: 'correctsRunId', target: T.PAYROLL_RUN, carrierRole: 'target', relation: 'corrects', category: 'correction' },

  // ── Postings to the ledger (document → journal entry) ──
  ...posting(T.SALES_INVOICE, 'journalEntryId', 'posted'),
  ...posting(T.SALES_INVOICE, 'costJournalEntryId', 'cost_posted'),
  ...posting(T.CUSTOMER_PAYMENT, 'journalEntryId', 'posted'),
  ...reversal(T.CUSTOMER_PAYMENT, 'reversalJournalEntryId'),
  ...posting(T.GOODS_RECEIPT, 'journalEntryId', 'posted'),
  ...reversal(T.GOODS_RECEIPT, 'reversalJournalEntryId'),
  ...posting(T.VENDOR_BILL, 'journalEntryId', 'posted'),
  ...reversal(T.VENDOR_BILL, 'reversalJournalEntryId'),
  ...posting(T.VENDOR_DEBIT_NOTE, 'journalEntryId', 'posted'),
  ...reversal(T.VENDOR_DEBIT_NOTE, 'reversalJournalEntryId'),
  ...posting(T.VENDOR_PAYMENT, 'journalEntryId', 'posted'),
  ...reversal(T.VENDOR_PAYMENT, 'reversalJournalEntryId'),
  ...posting(T.BANK_TRANSFER, 'journalEntryId', 'posted'),
  ...posting(T.INVENTORY_ADJUSTMENT, 'journalEntryId', 'posted'),
  ...posting(T.PAYROLL_RUN, 'journalEntryId', 'posted'),
  ...posting(T.PAYROLL_RUN, 'paymentJournalEntryId', 'payment_posted'),
  ...posting(T.INTERCOMPANY_TRANSACTION, 'sourceJournalEntryId', 'posted'),
  ...posting(T.INTERCOMPANY_TRANSACTION, 'destinationJournalEntryId', 'posted_counterparty'),
  ...posting(T.FIXED_ASSET, 'disposalJournalEntryId', 'disposal_posted'),
  { kind: 'junction', entity: 'FixedAssetDepreciation', aProp: 'fixedAssetId', aType: T.FIXED_ASSET, bProp: 'journalEntryId', bType: T.JOURNAL_ENTRY, sourceSide: 'a', tenantSide: 'a', relation: 'depreciated', category: 'posting' },

  // ── Journal entry ↔ journal entry ──
  { kind: 'fk', carrier: T.JOURNAL_ENTRY, prop: 'reversesEntryId', target: T.JOURNAL_ENTRY, carrierRole: 'target', relation: 'reversed', category: 'reversal' },
  { kind: 'fk', carrier: T.JOURNAL_ENTRY, prop: 'modifiedFromEntryId', target: T.JOURNAL_ENTRY, carrierRole: 'target', relation: 'modified', category: 'correction' },
  { kind: 'fk', carrier: T.JOURNAL_ENTRY, prop: 'modifiedToEntryId', target: T.JOURNAL_ENTRY, carrierRole: 'source', relation: 'modified', category: 'correction' },
];

function posting(carrier: FlowDocumentType, prop: string, relation: string): EdgeSpec[] {
  return [{ kind: 'fk', carrier, prop, target: T.JOURNAL_ENTRY, carrierRole: 'source', relation, category: 'posting' }];
}

function reversal(carrier: FlowDocumentType, prop: string): EdgeSpec[] {
  return [{ kind: 'fk', carrier, prop, target: T.JOURNAL_ENTRY, carrierRole: 'source', relation: 'reversed', category: 'reversal' }];
}

/** i18n key for a relation's edge label. */
export function relationKey(relation: string): string {
  return `relationship_map.rel.${relation}`;
}

/** Normalise a raw status into a kind, using the spec's explicit map only. */
export function statusLabelKeyOf(spec: NodeSpec, raw: string | null): string | null {
  if (!spec.statusLabelPrefix || raw == null || raw === '') return null;
  return `${spec.statusLabelPrefix}.${raw.trim().toLowerCase().replace(/\s+/g, '_')}`;
}

export function statusKindOf(spec: NodeSpec, raw: string | null): FlowStatusKind {
  if (raw == null || raw === '') return spec.statusFallback ?? 'unknown';
  return spec.statusMap?.[raw] ?? spec.statusFallback ?? 'unknown';
}
