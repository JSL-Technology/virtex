/**
 * The document relationship map: SAP Business One's «Mapa de relaciones», rebuilt here.
 *
 * SAP shows, for any commercial document, the whole chain it belongs to — a quotation that became
 * an order that became a delivery that became an invoice that was paid — as a graph the user can
 * read at a glance and click through. This module answers the same question for Virtex: given one
 * document, return every document reachable from it along a known business link, as nodes and edges
 * a diagram can draw.
 *
 * ## Why this lives in `reportes` and imports nothing
 *
 * The map spans Ventas, Compras and Contabilidad at once, so by the module boundary it is a
 * cross-module *read*, which is exactly what the `reportes` layer is for (dashboards, overview,
 * analytical reporting). Crucially it imports no other domain's code: the edges between documents
 * are read from the columns that already record them (`quotes.invoice_id`, `invoices.journal_entry_id`,
 * `purchase_order_receipts.order_id`…) through raw, tenant-scoped SQL driven by the declarative
 * registry in `document-flow.specs.ts`. A central module reaching into ten others' entities would be
 * a `private-import` and `foreign-entity-registration` boundary violation; this reaches into none.
 */

/** The kinds of document the map can show. Each maps to one table in `document-flow.specs.ts`. */
export enum FlowDocumentType {
  SALES_QUOTE = 'SALES_QUOTE',
  SALES_INVOICE = 'SALES_INVOICE',
  CUSTOMER_PAYMENT = 'CUSTOMER_PAYMENT',
  POS_SALE = 'POS_SALE',
  ECF_SUBMISSION = 'ECF_SUBMISSION',
  PURCHASE_REQUISITION = 'PURCHASE_REQUISITION',
  PURCHASE_ORDER = 'PURCHASE_ORDER',
  GOODS_RECEIPT = 'GOODS_RECEIPT',
  VENDOR_BILL = 'VENDOR_BILL',
  JOURNAL_ENTRY = 'JOURNAL_ENTRY',
}

/**
 * A document's lifecycle state, normalised across every type so the diagram colours one legend.
 *
 * The underlying tables each carry their own status enum in their own words — `Pending`,
 * `Partially Paid`, `POSTED`, `Draft` — and localising all of them would be a second catalogue to
 * keep in step. The map instead classifies each into one of these kinds (see `classifyStatus`),
 * colours the node by the kind, and keeps the raw value for a tooltip.
 */
export type FlowStatusKind = 'draft' | 'open' | 'closed' | 'cancelled' | 'unknown';

/** One document in the map. */
export interface FlowNode {
  /** Stable key `${type}:${id}`, used as the node id by the diagram and as the edge endpoints. */
  key: string;
  type: FlowDocumentType;
  id: string;
  /** i18n key for the type label, e.g. `relationship_map.doc.sales_invoice`. */
  typeKey: string;
  /** Lucide icon name for the node card. */
  icon: string;
  /** The human document number (`FAC-00128`, `OC-0007`). Null when the type has none. */
  number: string | null;
  /** i18n key for a subtype badge (credit note, debit note). Null for the ordinary case. */
  subtypeKey: string | null;
  /** ISO date (`YYYY-MM-DD`) of the document, or null. */
  date: string | null;
  statusKind: FlowStatusKind;
  /** The raw status as stored, for a tooltip. */
  statusRaw: string | null;
  /** Document total in `currencyCode`, or null when the type carries no single amount. */
  amount: number | null;
  currencyCode: string | null;
  /** Counterparty name (customer / supplier), frozen on the document or joined. Null when none. */
  party: string | null;
  /** Client route (no organisation prefix) that opens this document in a tab. Null = not clickable. */
  route: string | null;
  /** True for the single document the map was requested for. */
  root: boolean;
}

/** One business link between two documents. The arrow runs base → derived (source → target). */
export interface FlowEdge {
  /** `${type}:${id}` of the base (earlier) document. */
  from: string;
  /** `${type}:${id}` of the derived (later) document. */
  to: string;
  /** i18n key for the edge label, e.g. `relationship_map.rel.posted`. */
  relationKey: string;
}

/** The full map returned to the client. */
export interface DocumentFlowMap {
  /** `${type}:${id}` of the document the map was requested for. */
  root: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** True when the node cap was reached and the graph is a (connected) subset of the real chain. */
  truncated: boolean;
}
