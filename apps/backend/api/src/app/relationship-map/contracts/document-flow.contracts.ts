/**
 * The document relationship map: SAP Business One's «Mapa de relaciones», rebuilt here.
 *
 * SAP shows, for any commercial document, the whole chain it belongs to — a quotation that became
 * an invoice that was paid and posted — as a graph the user can read at a glance and click through.
 * This module answers the same question for Virtex: given one document, return every document
 * reachable from it along a known business link, as nodes and edges a diagram can draw.
 *
 * ## Why this lives in `reportes` and imports nothing
 *
 * The map spans Ventas, Compras, Tesorería, Inventario, RR.HH. and Contabilidad at once, so by the
 * module boundary it is a cross-module *read*, which is exactly what the `reportes` layer is for.
 * It imports no other domain's code: the links between documents are read from the columns that
 * already record them (`quotes.invoice_id`, `invoices.journal_entry_id`,
 * `vendor_payment.vendor_bill_id`…) through raw, tenant-scoped SQL driven by the declarative
 * registry in `document-flow.specs.ts`, resolved against TypeORM's runtime metadata by
 * `DocumentFlowCatalog`. A central module reaching into a dozen others' entities would be a
 * `private-import` and `foreign-entity-registration` boundary violation; this reaches into none.
 *
 * Everything in this file is the wire contract the client mirrors in
 * `features/relationship-map/data/relationship-map.models.ts`. Change both together.
 */

/** The kinds of document the map can show. Each maps to one entity in `document-flow.specs.ts`. */
export enum FlowDocumentType {
  // Ventas
  SALES_OPPORTUNITY = 'SALES_OPPORTUNITY',
  SALES_QUOTE = 'SALES_QUOTE',
  SALES_INVOICE = 'SALES_INVOICE',
  CUSTOMER_PAYMENT = 'CUSTOMER_PAYMENT',
  POS_SALE = 'POS_SALE',
  ECF_SUBMISSION = 'ECF_SUBMISSION',
  // Compras
  PURCHASE_REQUISITION = 'PURCHASE_REQUISITION',
  PURCHASE_ORDER = 'PURCHASE_ORDER',
  GOODS_RECEIPT = 'GOODS_RECEIPT',
  VENDOR_BILL = 'VENDOR_BILL',
  VENDOR_DEBIT_NOTE = 'VENDOR_DEBIT_NOTE',
  VENDOR_PAYMENT = 'VENDOR_PAYMENT',
  // Finanzas
  JOURNAL_ENTRY = 'JOURNAL_ENTRY',
  BANK_TRANSFER = 'BANK_TRANSFER',
  INTERCOMPANY_TRANSACTION = 'INTERCOMPANY_TRANSACTION',
  // Inventario
  INVENTORY_ADJUSTMENT = 'INVENTORY_ADJUSTMENT',
  // RR.HH.
  PAYROLL_RUN = 'PAYROLL_RUN',
  // Activos
  FIXED_ASSET = 'FIXED_ASSET',
}

/** Every document type, in declaration order. */
export const FLOW_DOCUMENT_TYPES: readonly FlowDocumentType[] = Object.values(FlowDocumentType);

/**
 * Type guard for an untrusted string (a route parameter).
 *
 * A membership test against the enum's values — never `value in SOME_RECORD`, which a request for a prototype key
 * (such as `__proto__`) satisfies through the prototype chain.
 */
export function isFlowDocumentType(value: unknown): value is FlowDocumentType {
  return typeof value === 'string' && (FLOW_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * The functional area a document belongs to. The diagram tints a node's stripe by it, the way SAP
 * tells sales, purchasing and finance documents apart, and the picker groups by it.
 */
export type FlowModule = 'sales' | 'purchasing' | 'finance' | 'inventory' | 'hr' | 'assets';

/**
 * A document's lifecycle state, normalised across every type so the diagram colours one legend.
 *
 * The underlying tables each carry their own status enum in their own words — `Pending`,
 * `PARTIALLY_RECEIVED`, `Posted`, `DRAFT`. Each spec maps its enum into these kinds explicitly;
 * nothing is guessed from the wording (a guess once painted a half-received order as finished,
 * because `PARTIALLY_RECEIVED` contains «received»). The raw value travels too, for a tooltip.
 */
export type FlowStatusKind = 'draft' | 'pending' | 'open' | 'closed' | 'cancelled' | 'unknown';

/**
 * What kind of business link an edge is. The diagram draws each differently, and the client can
 * hide whole categories — journal entries clutter a sales chain for someone who only wants the
 * commercial flow.
 */
export type FlowRelationCategory =
  /** The commercial flow proper: quote → invoice, order → receipt → bill. */
  | 'flow'
  /** A payment applied to what it pays. */
  | 'settlement'
  /** A document's posting to the general ledger. */
  | 'posting'
  /** A reversal or void entry. */
  | 'reversal'
  /** A correcting document: a credit/debit note, a corrected payroll run, a modified entry. */
  | 'correction'
  /** A regulatory artefact: the electronic fiscal document sent to the tax authority. */
  | 'fiscal';

/** One document in the map. */
export interface FlowNode {
  /** Stable key `${type}:${id}`, used as the node id by the diagram and as the edge endpoints. */
  key: string;
  type: FlowDocumentType;
  id: string;
  module: FlowModule;
  /** i18n key for the type label, e.g. `relationship_map.doc.sales_invoice`. */
  typeKey: string;
  /** The human document number (`FAC-00128`, `OC-0007`). Null when the type has none, or restricted. */
  number: string | null;
  /** i18n key for a subtype badge (credit note, debit note). Null for the ordinary case. */
  subtypeKey: string | null;
  /** Free text (a journal entry's memo, an asset's name). Null when none, or restricted. */
  description: string | null;
  /** ISO date (`YYYY-MM-DD`) of the document, or null. */
  date: string | null;
  statusKind: FlowStatusKind;
  /** The raw status as stored, for a tooltip. */
  statusRaw: string | null;
  /** Document total in `currencyCode` (null currency = the tenant's base currency), or null. */
  amount: number | null;
  currencyCode: string | null;
  /** Counterparty name (customer / supplier). Null when none, or restricted. */
  party: string | null;
  /** True for the single document the map was requested for. */
  root: boolean;
  /** Hops from the root along the graph (root = 0). */
  depth: number;
  /**
   * The caller may not read this document — no permission for its module, or it belongs to a branch
   * outside their scope. The node stays so the chain keeps its true shape, but every identifying
   * field (number, party, amount, date, status, description) is withheld.
   */
  restricted: boolean;
}

/** One business link between two documents. The arrow runs base → derived (source → target). */
export interface FlowEdge {
  /** Stable key `${from}|${to}|${relation}`. */
  key: string;
  /** `${type}:${id}` of the base (earlier) document. */
  from: string;
  /** `${type}:${id}` of the derived (later) document. */
  to: string;
  /** Machine name of the relation (`invoiced`, `posted`…). */
  relation: string;
  /** i18n key for the edge label, e.g. `relationship_map.rel.posted`. */
  relationKey: string;
  category: FlowRelationCategory;
}

/** Why the drawn graph is a subset of the real chain. All false means the map is complete. */
export interface FlowTruncation {
  /** The node cap was reached. */
  nodes: boolean;
  /** Documents exist beyond the depth limit. */
  depth: boolean;
  /** One document had more links of one kind than the map draws (an asset's 120 depreciations). */
  fanOut: boolean;
}

/** The full map returned to the client. */
export interface DocumentFlowMap {
  /** `${type}:${id}` of the document the map was requested for. */
  root: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** True when any of `truncation` is. */
  truncated: boolean;
  truncation: FlowTruncation;
  /** The limits this map was built under, after clamping the request's. */
  limits: { maxNodes: number; maxDepth: number };
  /** The furthest hop actually reached. */
  depthReached: number;
  /** ISO timestamp of the snapshot the map was read from. */
  generatedAt: string;
}

/** A document type the caller can open a map from, for the picker on the empty page. */
export interface FlowDocumentTypeInfo {
  type: FlowDocumentType;
  module: FlowModule;
  typeKey: string;
  /** The type has a document number the search can match. */
  searchable: boolean;
}

/** One search result: enough to recognise the document and open its map. */
export interface FlowDocumentSearchHit {
  key: string;
  type: FlowDocumentType;
  id: string;
  module: FlowModule;
  typeKey: string;
  number: string | null;
  description: string | null;
  date: string | null;
  party: string | null;
  amount: number | null;
  currencyCode: string | null;
  statusKind: FlowStatusKind;
}
