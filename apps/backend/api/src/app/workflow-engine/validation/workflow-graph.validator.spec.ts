import { WorkflowGraph, WorkflowNodeType, WorkflowTrigger } from '../contracts/workflow-graph';
import { WorkflowValidationContext, semanticIssues, structuralIssues } from './workflow-graph.validator';

const USER = '11111111-1111-4111-8111-111111111111';
const ROLE = '22222222-2222-4222-8222-222222222222';
const MANUAL: WorkflowTrigger = { mode: 'manual' };

const ctx: WorkflowValidationContext = {
  actionParams: (key) =>
    key === 'notify'
      ? [{ name: 'message', labelKey: 'm', type: 'text', required: true }]
      : key === 'webhook'
        ? [{ name: 'url', labelKey: 'u', type: 'url', required: true }]
        : key === 'log'
          ? []
          : undefined,
  isKnownEvent: (event) => event === 'invoice.issued' || event.startsWith('custom.'),
  userIds: new Set([USER]),
  roleIds: new Set([ROLE]),
};

/** Start → approval → (approve: end ok | reject: end ko). */
function approvalGraph(): WorkflowGraph {
  return {
    nodes: [
      { id: 's', type: WorkflowNodeType.START },
      { id: 'a', type: WorkflowNodeType.APPROVAL, name: 'Aprobar', config: { assigneeUserId: USER } },
      { id: 'ok', type: WorkflowNodeType.END, name: 'Aprobado' },
      { id: 'ko', type: WorkflowNodeType.END, name: 'Rechazado' },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'a' },
      { id: 'e2', from: 'a', to: 'ok', outcome: 'approve' },
      { id: 'e3', from: 'a', to: 'ko', outcome: 'reject' },
    ],
  };
}

const codes = (issues: { code: string; severity: string }[]) => issues.filter((i) => i.severity === 'error').map((i) => i.code);

describe('workflow graph validation', () => {
  it('accepts a complete approval process', () => {
    expect(codes(semanticIssues(approvalGraph(), MANUAL, ctx))).toEqual([]);
  });

  describe('structure (on every save)', () => {
    it('rejects malformed graphs, dangling and self edges, bad ids and limits', () => {
      expect(codes(structuralIssues(null))).toEqual(['graph_malformed']);
      expect(codes(structuralIssues({ nodes: 'x', edges: [] }))).toEqual(['graph_malformed']);
      const graph = approvalGraph();
      graph.edges.push({ id: 'bad', from: 's', to: 'nope' }, { id: 'self', from: 'a', to: 'a' });
      graph.nodes.push({ id: 'has space', type: WorkflowNodeType.TASK });
      expect(codes(structuralIssues(graph))).toEqual(expect.arrayContaining(['edge_dangling', 'edge_self_loop', 'node_bad_id']));
    });

    it('rejects negative durations, duplicate outcomes and malformed conditions', () => {
      const graph = approvalGraph();
      graph.nodes[1].config = { ...graph.nodes[1].config, dueInHours: -3, outcomes: ['ok', 'ok'] };
      graph.nodes.push({ id: 'w', type: WorkflowNodeType.TIMER, config: { timerMinutes: -5 } });
      graph.edges.push({ id: 'c', from: 'w', to: 'ok', condition: { var: 'amount', op: 'gt' } as never });
      expect(codes(structuralIssues(graph))).toEqual(
        expect.arrayContaining(['due_hours_invalid', 'outcomes_duplicate', 'timer_minutes_invalid', 'condition_missing_value']),
      );
    });

    it('rejects assignee ids that are not UUIDs', () => {
      const graph = approvalGraph();
      graph.nodes[1].config = { assigneeUserId: 'no-es-un-uuid' };
      expect(codes(structuralIssues(graph))).toContain('assignee_user_invalid');
    });

    it('bounds predicate depth', () => {
      let deep: object = { var: 'x', op: 'truthy' };
      for (let i = 0; i < 12; i += 1) deep = { not: deep };
      const graph = approvalGraph();
      graph.edges[0].condition = deep as never;
      expect(codes(structuralIssues(graph))).toContain('condition_too_deep');
    });
  });

  describe('semantics (at publish)', () => {
    it('reports every problem at once, located on its node', () => {
      const graph: WorkflowGraph = {
        nodes: [
          { id: 's', type: WorkflowNodeType.START },
          { id: 't', type: WorkflowNodeType.TASK, name: 'Revisar' },
          { id: 'x', type: WorkflowNodeType.ACTION, name: 'Avisar', config: { action: 'notify' } },
          { id: 'e', type: WorkflowNodeType.END },
        ],
        edges: [{ id: 'e1', from: 's', to: 't' }],
      };
      const issues = semanticIssues(graph, MANUAL, ctx);
      expect(issues.filter((i) => i.nodeId === 't').map((i) => i.code)).toEqual(expect.arrayContaining(['task_no_assignee', 'node_no_exit']));
      expect(issues.filter((i) => i.nodeId === 'x').map((i) => i.code)).toEqual(
        expect.arrayContaining(['action_param_required', 'node_no_entry', 'node_no_exit']),
      );
      expect(issues.find((i) => i.code === 'node_no_exit')?.params?.['node']).toBe('Revisar');
    });

    it('requires every outcome to be routed, or a default', () => {
      const graph = approvalGraph();
      graph.edges = graph.edges.filter((edge) => edge.id !== 'e3');
      expect(codes(semanticIssues(graph, MANUAL, ctx))).toContain('outcome_unrouted');
      graph.edges[1].default = true;
      expect(codes(semanticIssues(graph, MANUAL, ctx))).not.toContain('outcome_unrouted');
    });

    it('requires a condition gateway to have a default and conditions on the other branches', () => {
      const graph: WorkflowGraph = {
        nodes: [
          { id: 's', type: WorkflowNodeType.START },
          { id: 'c', type: WorkflowNodeType.CONDITION, name: 'Monto' },
          { id: 'e1', type: WorkflowNodeType.END },
          { id: 'e2', type: WorkflowNodeType.END },
        ],
        edges: [
          { id: 'a', from: 's', to: 'c' },
          { id: 'b', from: 'c', to: 'e1' },
          { id: 'd', from: 'c', to: 'e2' },
        ],
      };
      expect(codes(semanticIssues(graph, MANUAL, ctx))).toEqual(expect.arrayContaining(['condition_needs_default', 'branch_needs_condition']));
      graph.edges[1].condition = { var: 'amount', op: 'gt', value: 10 };
      graph.edges[2].default = true;
      expect(codes(semanticIssues(graph, MANUAL, ctx))).toEqual([]);
    });

    it('rejects unknown assignees, unknown actions and unknown events', () => {
      const graph = approvalGraph();
      graph.nodes[1].config = { assigneeRoleId: '33333333-3333-4333-8333-333333333333' };
      expect(codes(semanticIssues(graph, MANUAL, ctx))).toContain('assignee_role_unknown');
      expect(codes(semanticIssues(approvalGraph(), { mode: 'event' }, ctx))).toContain('trigger_needs_event');
      expect(codes(semanticIssues(approvalGraph(), { mode: 'event', event: 'nope.event' }, ctx))).toContain('trigger_unknown_event');
      expect(codes(semanticIssues(approvalGraph(), { mode: 'event', event: 'custom.order-synced' }, ctx))).toEqual([]);
    });

    it('detects nodes that are unreachable or can never finish', () => {
      const graph = approvalGraph();
      graph.nodes.push({ id: 'island', type: WorkflowNodeType.TASK, config: { assigneeUserId: USER } }, { id: 'island2', type: WorkflowNodeType.TASK, config: { assigneeUserId: USER } });
      graph.edges.push({ id: 'i1', from: 'island2', to: 'island' }, { id: 'i2', from: 'island', to: 'island2' });
      const found = codes(semanticIssues(graph, MANUAL, ctx));
      expect(found).toEqual(expect.arrayContaining(['node_unreachable']));
    });

    it('refuses a loop made only of automatic steps but allows a rework loop through a task', () => {
      const loop: WorkflowGraph = {
        nodes: [
          { id: 's', type: WorkflowNodeType.START },
          { id: 'l1', type: WorkflowNodeType.ACTION, config: { action: 'log' } },
          { id: 'c', type: WorkflowNodeType.CONDITION },
          { id: 'e', type: WorkflowNodeType.END },
        ],
        edges: [
          { id: 'a', from: 's', to: 'l1' },
          { id: 'b', from: 'l1', to: 'c' },
          { id: 'd', from: 'c', to: 'l1', condition: { var: 'again', op: 'truthy' } },
          { id: 'f', from: 'c', to: 'e', default: true },
        ],
      };
      expect(codes(semanticIssues(loop, MANUAL, ctx))).toContain('automatic_loop');

      const rework = approvalGraph();
      rework.edges[2] = { id: 'e3', from: 'a', to: 'a2', outcome: 'reject' };
      rework.nodes.push({ id: 'a2', type: WorkflowNodeType.TASK, name: 'Corregir', config: { assigneeUserId: USER } });
      rework.edges.push({ id: 'back', from: 'a2', to: 'a' });
      expect(codes(semanticIssues(rework, MANUAL, ctx))).not.toContain('automatic_loop');
    });

    it('warns (without blocking) about undeclared variables in conditions', () => {
      const graph: WorkflowGraph = {
        nodes: [
          { id: 's', type: WorkflowNodeType.START },
          { id: 'c', type: WorkflowNodeType.CONDITION },
          { id: 'e1', type: WorkflowNodeType.END },
          { id: 'e2', type: WorkflowNodeType.END },
        ],
        edges: [
          { id: 'a', from: 's', to: 'c' },
          { id: 'b', from: 'c', to: 'e1', condition: { var: 'monto', op: 'gt', value: 1 } },
          { id: 'd', from: 'c', to: 'e2', default: true },
        ],
      };
      const issues = semanticIssues(graph, MANUAL, ctx);
      expect(codes(issues)).toEqual([]);
      expect(issues.some((i) => i.code === 'variable_undeclared' && i.severity === 'warning')).toBe(true);
      graph.variables = [{ name: 'monto', type: 'number' }];
      expect(semanticIssues(graph, MANUAL, ctx).some((i) => i.code === 'variable_undeclared')).toBe(false);
    });
  });
});
