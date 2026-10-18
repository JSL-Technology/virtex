import { WorkflowGraph, WorkflowTrigger } from './workflow.service';

/**
 * Ready-made processes an author can start from.
 *
 * Each is a complete, routable graph — every outcome connected, every gateway with a fallback —
 * that only lacks what cannot be known in advance: who does each step. Publishing one before
 * assigning people fails with exactly those issues marked on the canvas, which is the guidance the
 * author needs. Names and labels are catalogue keys, translated when the template is applied.
 */
export interface WorkflowTemplate {
  id: string;
  nameKey: string;
  descriptionKey: string;
  icon: 'approval' | 'invoice' | 'customer' | 'bill' | 'blank';
  trigger: WorkflowTrigger;
  /** Labels are catalogue keys; `apply` translates them. */
  graph: WorkflowGraph;
}

const T = 'workflow_engine.template';

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'blank',
    nameKey: `${T}.blank.name`,
    descriptionKey: `${T}.blank.description`,
    icon: 'blank',
    trigger: { mode: 'manual' },
    graph: {
      nodes: [
        { id: 'start', type: 'start', position: { x: 80, y: 200 } },
        { id: 'end', type: 'end', name: `${T}.label.done`, position: { x: 480, y: 200 } },
      ],
      edges: [{ id: 'e1', from: 'start', to: 'end' }],
      variables: [],
      groups: [],
      settings: { connectionType: 'bezier', layoutDirection: 'LR' },
    },
  },
  {
    id: 'purchase-approval',
    nameKey: `${T}.purchase.name`,
    descriptionKey: `${T}.purchase.description`,
    icon: 'approval',
    trigger: { mode: 'event', event: 'purchase-order.created' },
    // The decision lands on the purchase order itself — approved, or returned to draft with the
    // reviewer's reason — through «Decide the document». If the order refuses it (its creator
    // cannot approve it, or it moved on), the requester is told and the run ends for manual review.
    graph: {
      variables: [
        { name: 'total', label: `${T}.label.amount`, type: 'number', required: true, min: 0 },
        { name: 'supplierName', label: `${T}.label.supplier`, type: 'string' },
        { name: 'number', label: `${T}.label.document`, type: 'string' },
      ],
      groups: [
        { id: 'lane-buyer', name: `${T}.label.lane_purchasing`, position: { x: 240, y: 40 }, size: { width: 320, height: 680 }, color: 'viz-1' },
        { id: 'lane-mgmt', name: `${T}.label.lane_management`, position: { x: 600, y: 40 }, size: { width: 780, height: 680 }, color: 'viz-3' },
      ],
      nodes: [
        { id: 'start', type: 'start', position: { x: 40, y: 240 } },
        { id: 'review', type: 'task', name: `${T}.label.review_request`, parentId: 'lane-buyer', position: { x: 280, y: 240 }, config: { outcomes: ['ok', 'return'], dueInHours: 24, commentRequiredFor: ['return'] } },
        { id: 'doc_return', type: 'action', name: `${T}.label.return_order`, parentId: 'lane-buyer', position: { x: 280, y: 420 }, config: { action: 'document_decision', actionParams: { decision: 'reject', reason: '{{lastComment}}' } } },
        { id: 'returned', type: 'end', name: `${T}.label.returned`, parentId: 'lane-buyer', position: { x: 280, y: 600 } },
        { id: 'amount', type: 'condition', name: `${T}.label.over_threshold`, parentId: 'lane-mgmt', position: { x: 640, y: 240 } },
        { id: 'approve', type: 'approval', name: `${T}.label.manager_approval`, parentId: 'lane-mgmt', position: { x: 900, y: 100 }, config: { outcomes: ['approve', 'reject'], commentRequiredFor: ['reject'], dueInHours: 48 } },
        { id: 'doc_approve', type: 'action', name: `${T}.label.approve_order`, parentId: 'lane-mgmt', position: { x: 1150, y: 60 }, config: { action: 'document_decision', actionParams: { decision: 'approve', reason: '{{lastComment}}' } } },
        { id: 'doc_reject', type: 'action', name: `${T}.label.reject_order`, parentId: 'lane-mgmt', position: { x: 1150, y: 220 }, config: { action: 'document_decision', actionParams: { decision: 'reject', reason: '{{lastComment}}' } } },
        { id: 'doc_auto', type: 'action', name: `${T}.label.auto_approve_order`, parentId: 'lane-mgmt', position: { x: 900, y: 420 }, config: { action: 'document_decision', actionParams: { decision: 'approve', reason: '' } } },
        { id: 'notify_fail', type: 'action', name: `${T}.label.notify_failure`, parentId: 'lane-mgmt', position: { x: 1150, y: 580 }, config: { action: 'notify', actionParams: { message: `${T}.label.notify_failure_message` } } },
        { id: 'approved', type: 'end', name: `${T}.label.approved`, position: { x: 1420, y: 60 } },
        { id: 'rejected', type: 'end', name: `${T}.label.rejected`, position: { x: 1420, y: 220 } },
        { id: 'auto', type: 'end', name: `${T}.label.auto_approved`, position: { x: 1420, y: 420 } },
        { id: 'failed', type: 'end', name: `${T}.label.needs_manual_review`, position: { x: 1420, y: 580 } },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'review' },
        { id: 'e2', from: 'review', to: 'amount', outcome: 'ok' },
        { id: 'e3', from: 'review', to: 'doc_return', outcome: 'return' },
        { id: 'e4', from: 'doc_return', to: 'returned', outcome: 'ok' },
        { id: 'e5', from: 'doc_return', to: 'notify_fail', outcome: 'error' },
        { id: 'e6', from: 'amount', to: 'approve', condition: { all: [{ var: 'total', op: 'gt', value: 10000 }] } },
        { id: 'e7', from: 'amount', to: 'doc_auto', default: true },
        { id: 'e8', from: 'approve', to: 'doc_approve', outcome: 'approve' },
        { id: 'e9', from: 'approve', to: 'doc_reject', outcome: 'reject' },
        { id: 'e10', from: 'doc_approve', to: 'approved', outcome: 'ok' },
        { id: 'e11', from: 'doc_approve', to: 'notify_fail', outcome: 'error' },
        { id: 'e12', from: 'doc_reject', to: 'rejected', outcome: 'ok' },
        { id: 'e13', from: 'doc_reject', to: 'notify_fail', outcome: 'error' },
        { id: 'e14', from: 'doc_auto', to: 'auto', outcome: 'ok' },
        { id: 'e15', from: 'doc_auto', to: 'notify_fail', outcome: 'error' },
        { id: 'e16', from: 'notify_fail', to: 'failed' },
      ],
      settings: { connectionType: 'bezier', layoutDirection: 'LR' },
    },
  },
  {
    id: 'invoice-approval',
    nameKey: `${T}.invoice.name`,
    descriptionKey: `${T}.invoice.description`,
    icon: 'invoice',
    trigger: { mode: 'event', event: 'invoice.created' },
    graph: {
      variables: [
        { name: 'total', label: `${T}.label.amount`, type: 'number', min: 0 },
        { name: 'customerName', label: `${T}.label.customer`, type: 'string' },
        { name: 'invoiceNumber', label: `${T}.label.document`, type: 'string' },
      ],
      groups: [],
      nodes: [
        { id: 'start', type: 'start', position: { x: 60, y: 200 } },
        { id: 'check', type: 'condition', name: `${T}.label.over_threshold`, position: { x: 300, y: 200 } },
        { id: 'approve', type: 'approval', name: `${T}.label.credit_approval`, position: { x: 560, y: 100 }, config: { outcomes: ['approve', 'reject'], commentRequiredFor: ['reject'], dueInHours: 24 } },
        { id: 'approved', type: 'end', name: `${T}.label.approved`, position: { x: 840, y: 60 } },
        { id: 'rejected', type: 'end', name: `${T}.label.rejected`, position: { x: 840, y: 180 } },
        { id: 'auto', type: 'end', name: `${T}.label.auto_approved`, position: { x: 560, y: 320 } },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'check' },
        { id: 'e2', from: 'check', to: 'approve', condition: { all: [{ var: 'total', op: 'gte', value: 50000 }] } },
        { id: 'e3', from: 'check', to: 'auto', default: true },
        { id: 'e4', from: 'approve', to: 'approved', outcome: 'approve' },
        { id: 'e5', from: 'approve', to: 'rejected', outcome: 'reject' },
      ],
      settings: { connectionType: 'bezier', layoutDirection: 'LR' },
    },
  },
  {
    id: 'customer-onboarding',
    nameKey: `${T}.customer.name`,
    descriptionKey: `${T}.customer.description`,
    icon: 'customer',
    trigger: { mode: 'event', event: 'customer.created' },
    graph: {
      variables: [
        { name: 'customerName', label: `${T}.label.customer`, type: 'string' },
        { name: 'creditLimit', label: `${T}.label.credit_limit`, type: 'number', min: 0 },
      ],
      groups: [],
      nodes: [
        { id: 'start', type: 'start', position: { x: 60, y: 200 } },
        { id: 'kyc', type: 'task', name: `${T}.label.verify_documents`, position: { x: 300, y: 200 }, config: { outcomes: ['done'], dueInHours: 48, form: [{ name: 'creditLimit', label: `${T}.label.credit_limit`, type: 'number', required: true, min: 0 }] } },
        { id: 'wait', type: 'timer', name: `${T}.label.follow_up`, position: { x: 560, y: 200 }, config: { timerMinutes: 60 * 24 * 7 } },
        { id: 'call', type: 'task', name: `${T}.label.welcome_call`, position: { x: 820, y: 200 }, config: { outcomes: ['done'], dueInHours: 24 } },
        { id: 'end', type: 'end', name: `${T}.label.done`, position: { x: 1080, y: 200 } },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'kyc' },
        { id: 'e2', from: 'kyc', to: 'wait' },
        { id: 'e3', from: 'wait', to: 'call' },
        { id: 'e4', from: 'call', to: 'end' },
      ],
      settings: { connectionType: 'bezier', layoutDirection: 'LR' },
    },
  },
  {
    id: 'vendor-bill-review',
    nameKey: `${T}.bill.name`,
    descriptionKey: `${T}.bill.description`,
    icon: 'bill',
    trigger: { mode: 'event', event: 'vendor.bill.posted' },
    graph: {
      variables: [],
      groups: [],
      nodes: [
        { id: 'start', type: 'start', position: { x: 60, y: 200 } },
        { id: 'review', type: 'approval', name: `${T}.label.review_bill`, position: { x: 300, y: 200 }, config: { outcomes: ['approve', 'reject'], commentRequiredFor: ['reject'], dueInHours: 72 } },
        { id: 'notify', type: 'action', name: `${T}.label.notify_requester`, position: { x: 560, y: 300 }, config: { action: 'notify', actionParams: { message: `${T}.label.notify_message` } } },
        { id: 'ok', type: 'end', name: `${T}.label.approved`, position: { x: 560, y: 100 } },
        { id: 'ko', type: 'end', name: `${T}.label.rejected`, position: { x: 820, y: 300 } },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'review' },
        { id: 'e2', from: 'review', to: 'ok', outcome: 'approve' },
        { id: 'e3', from: 'review', to: 'notify', outcome: 'reject' },
        { id: 'e4', from: 'notify', to: 'ko' },
      ],
      settings: { connectionType: 'bezier', layoutDirection: 'LR' },
    },
  },
];

/** A template's graph with its catalogue keys turned into the reader's words. */
export function applyTemplate(template: WorkflowTemplate, t: (key: string) => string): { graph: WorkflowGraph; trigger: WorkflowTrigger } {
  const tr = (value?: string) => (value && value.startsWith(`${T}.`) ? t(value) : value);
  const graph = structuredClone(template.graph);
  graph.nodes = graph.nodes.map((node) => ({
    ...node,
    name: tr(node.name),
    config: node.config?.actionParams
      ? { ...node.config, actionParams: Object.fromEntries(Object.entries(node.config.actionParams).map(([k, v]) => [k, typeof v === 'string' ? tr(v) : v])) }
      : node.config,
  }));
  graph.groups = (graph.groups ?? []).map((group) => ({ ...group, name: tr(group.name) }));
  graph.variables = (graph.variables ?? []).map((variable) => ({ ...variable, label: tr(variable.label) }));
  return { graph, trigger: structuredClone(template.trigger) };
}
