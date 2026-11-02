/**
 * The relationship-map wire contract, mirrored from the API's
 * `relationship-map/contracts/document-flow.contracts.ts`. Change both together.
 */

export type FlowDocumentType =
  | 'SALES_OPPORTUNITY'
  | 'SALES_QUOTE'
  | 'SALES_INVOICE'
  | 'CUSTOMER_PAYMENT'
  | 'POS_SALE'
  | 'ECF_SUBMISSION'
  | 'PURCHASE_REQUISITION'
  | 'PURCHASE_ORDER'
  | 'GOODS_RECEIPT'
  | 'VENDOR_BILL'
  | 'VENDOR_DEBIT_NOTE'
  | 'VENDOR_PAYMENT'
  | 'JOURNAL_ENTRY'
  | 'BANK_TRANSFER'
  | 'INTERCOMPANY_TRANSACTION'
  | 'INVENTORY_ADJUSTMENT'
  | 'PAYROLL_RUN'
  | 'FIXED_ASSET';

export type FlowModule = 'sales' | 'purchasing' | 'finance' | 'inventory' | 'hr' | 'assets';

export type FlowStatusKind = 'draft' | 'pending' | 'open' | 'closed' | 'cancelled' | 'unknown';

export type FlowRelationCategory = 'flow' | 'settlement' | 'posting' | 'reversal' | 'correction' | 'fiscal';

export interface FlowNode {
  key: string;
  type: FlowDocumentType;
  id: string;
  module: FlowModule;
  typeKey: string;
  number: string | null;
  subtypeKey: string | null;
  description: string | null;
  date: string | null;
  statusKind: FlowStatusKind;
  /** The document's own status label («Cobrada»), when its type has one (QA R3-M13). */
  statusKey?: string | null;
  statusRaw: string | null;
  amount: number | null;
  currencyCode: string | null;
  party: string | null;
  root: boolean;
  depth: number;
  restricted: boolean;
}

export interface FlowEdge {
  key: string;
  from: string;
  to: string;
  relation: string;
  relationKey: string;
  category: FlowRelationCategory;
}

export interface FlowTruncation {
  nodes: boolean;
  depth: boolean;
  fanOut: boolean;
}

export interface DocumentFlowMap {
  root: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  truncated: boolean;
  truncation: FlowTruncation;
  limits: { maxNodes: number; maxDepth: number };
  depthReached: number;
  generatedAt: string;
}

export interface FlowDocumentTypeInfo {
  type: FlowDocumentType;
  module: FlowModule;
  typeKey: string;
  searchable: boolean;
}

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
  /** The document's own status label («Cobrada»), when its type has one (QA R3-M13). */
  statusKey?: string | null;
}

export interface FlowMapOptions {
  depth?: number;
  limit?: number;
}

/** Limits the server accepts (`FLOW_LIMITS` there). */
export const FLOW_DEPTH_CHOICES = [2, 4, 8, 12, 20] as const;
export const FLOW_DEFAULT_DEPTH = 8;
export const FLOW_DEFAULT_LIMIT = 150;
export const FLOW_MAX_LIMIT = 400;
