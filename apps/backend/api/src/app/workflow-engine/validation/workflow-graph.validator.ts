import {
  UNARY_PREDICATE_OPS,
  WORKFLOW_LIMITS,
  WORKFLOW_NODE_TYPES,
  WORKFLOW_PREDICATE_OPS,
  WORKFLOW_VARIABLE_TYPES,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowNodeType,
  WorkflowPredicate,
  WorkflowTrigger,
  WorkflowVariable,
} from '../contracts/workflow-graph';
import { predicateVariables } from '../contracts/workflow-predicate';

/**
 * One problem with a workflow design, located on the node or connection it concerns.
 *
 * Issues are data, not exceptions: the designer receives every one of them at once and marks the
 * offending nodes on the canvas, instead of learning about them one publish attempt at a time.
 * `code` maps to the catalogue key `workflow_engine.issue.<code>`; `params` fills its placeholders.
 */
export interface WorkflowIssue {
  code: string;
  severity: 'error' | 'warning';
  nodeId?: string;
  edgeId?: string;
  params?: Record<string, string | number>;
}

/** A parameter an action accepts — the schema the designer renders a form from. */
export interface WorkflowActionParam {
  name: string;
  labelKey: string;
  type: 'string' | 'text' | 'number' | 'boolean' | 'url' | 'user' | 'select' | 'json' | 'process' | 'variable';
  /** For `select`: catalogue keys for each option's label (`option` → key). */
  optionLabelKeys?: Record<string, string>;
  /** A default the designer pre-fills. */
  defaultValue?: string;
  required?: boolean;
  options?: string[];
  /** For `string`/`text`: `{{variable}}` placeholders are rendered from the context at runtime. */
  templated?: boolean;
  maxLength?: number;
  hintKey?: string;
}

/** What semantic validation needs to know about the world outside the graph. */
export interface WorkflowValidationContext {
  actionParams: (key: string) => readonly WorkflowActionParam[] | undefined;
  isKnownEvent: (event: string) => boolean;
  userIds: ReadonlySet<string>;
  roleIds: ReadonlySet<string>;
  /** Outcomes an action may return (`webhook` → ok/error). Absent: the action returns none. */
  actionOutcomes?: (key: string) => readonly string[] | undefined;
  /**
   * The variables a catalogued event delivers. `undefined` for an event whose payload is not known
   * in advance (a `custom.*` integration event): then an undeclared variable can only be a warning.
   */
  eventFields?: (event: string) => readonly string[] | undefined;
  /** Variables an action writes into the context when it runs (`set_variable` → its target name). */
  actionWrites?: (key: string, params: Record<string, unknown>) => readonly string[];
  /**
   * Roles and users that hold the grant to answer a task. A task assigned outside these sets can
   * never be completed: the person is notified, opens it and is refused, and the run stalls.
   */
  actingRoleIds?: ReadonlySet<string>;
  actingUserIds?: ReadonlySet<string>;
  /** Active members per role, to warn about a task assigned to a role nobody holds. */
  roleMemberCounts?: ReadonlyMap<string, number>;
  /** Whether plain `http://` webhooks are accepted (development only). */
  allowHttpWebhooks?: boolean;
}

/**
 * Codes after which the rest of the checks cannot run meaningfully (ids, references, types). Any
 * other structural problem — a malformed variable, an over-long text — is reported TOGETHER with
 * the semantic ones, so fixing one issue never reveals three more that were there all along.
 */
const FATAL_STRUCTURAL: ReadonlySet<string> = new Set([
  'graph_malformed',
  'too_many_nodes',
  'too_many_edges',
  'node_malformed',
  'node_bad_id',
  'node_bad_type',
  'duplicate_node_id',
  'edge_malformed',
  'edge_dangling',
  'duplicate_edge_id',
  'config_malformed',
]);

/** Variables the engine itself writes into every instance context. */
export const ENGINE_VARIABLES: readonly string[] = [
  'lastOutcome',
  'lastComment',
  'lastActorUserId',
  'event',
  'webhook',
  'subprocess',
  'document',
  'parentInstanceId',
];

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,4}$/;
const OUTCOME = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HUMAN: ReadonlySet<WorkflowNodeType> = new Set([WorkflowNodeType.TASK, WorkflowNodeType.APPROVAL]);
/** Nodes that park a token: a loop containing one of these is a legitimate rework cycle. */
const WAITING: ReadonlySet<WorkflowNodeType> = new Set([
  WorkflowNodeType.TASK,
  WorkflowNodeType.APPROVAL,
  WorkflowNodeType.TIMER,
]);

const label = (node: WorkflowGraphNode | undefined, fallback = '?'): string =>
  node?.name?.trim() || node?.id || fallback;

/**
 * Errors that make a graph unstorable — wrong types, impossible references, sizes past the limits.
 *
 * These are enforced on every save, draft included: a draft may be incomplete (no end yet, a task
 * without an assignee), but never malformed. Everything about whether the process can *run* waits
 * for {@link semanticIssues} at publish.
 */
export function structuralIssues(graph: unknown, trigger?: unknown): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const add = (code: string, extra: Partial<WorkflowIssue> = {}) =>
    issues.push({ code, severity: 'error', ...extra });

  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    add('graph_malformed');
    return issues;
  }
  const g = graph as Partial<WorkflowGraph>;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    add('graph_malformed');
    return issues;
  }
  if (g.nodes.length > WORKFLOW_LIMITS.maxNodes) add('too_many_nodes', { params: { max: WORKFLOW_LIMITS.maxNodes } });
  if (g.edges.length > WORKFLOW_LIMITS.maxEdges) add('too_many_edges', { params: { max: WORKFLOW_LIMITS.maxEdges } });
  if (issues.length) return issues;

  const ids = new Set<string>();
  const groupIds = new Set<string>();

  if (g.groups !== undefined) {
    if (!Array.isArray(g.groups) || g.groups.length > WORKFLOW_LIMITS.maxGroups) add('groups_malformed');
    else
      for (const group of g.groups) {
        if (!group || typeof group.id !== 'string' || !ID.test(group.id) || groupIds.has(group.id)) {
          add('groups_malformed');
          continue;
        }
        groupIds.add(group.id);
        if (group.name !== undefined && !isText(group.name, WORKFLOW_LIMITS.maxNameLength)) add('groups_malformed');
        if (group.position !== undefined && !isPoint(group.position)) add('groups_malformed');
        if (
          group.size !== undefined &&
          !(isFiniteNumber(group.size?.width) && isFiniteNumber(group.size?.height) && group.size.width > 0 && group.size.height > 0)
        )
          add('groups_malformed');
      }
  }

  if (g.variables !== undefined) {
    if (!Array.isArray(g.variables) || g.variables.length > WORKFLOW_LIMITS.maxVariables) add('variables_malformed');
    else issues.push(...variableIssues(g.variables, 'variable'));
  }

  for (const node of g.nodes as WorkflowGraphNode[]) {
    if (!node || typeof node !== 'object') {
      add('node_malformed');
      continue;
    }
    if (typeof node.id !== 'string' || !ID.test(node.id)) {
      add('node_bad_id');
      continue;
    }
    if (ids.has(node.id)) add('duplicate_node_id', { nodeId: node.id });
    ids.add(node.id);
    if (!WORKFLOW_NODE_TYPES.includes(node.type)) add('node_bad_type', { nodeId: node.id });
    if (node.name !== undefined && !isText(node.name, WORKFLOW_LIMITS.maxNameLength))
      add('node_name_too_long', { nodeId: node.id, params: { max: WORKFLOW_LIMITS.maxNameLength } });
    if (node.description !== undefined && !isText(node.description, WORKFLOW_LIMITS.maxTextLength))
      add('text_too_long', { nodeId: node.id });
    if (node.position !== undefined && !isPoint(node.position)) add('node_bad_position', { nodeId: node.id });
    if (node.parentId !== undefined && !groupIds.has(node.parentId)) add('node_bad_group', { nodeId: node.id });
    if (node.config !== undefined) issues.push(...configIssues(node));
  }

  const pairs = new Set<string>();
  const edgeIds = new Set<string>();
  for (const edge of g.edges as WorkflowGraphEdge[]) {
    if (!edge || typeof edge !== 'object' || typeof edge.id !== 'string' || !ID.test(edge.id)) {
      add('edge_malformed');
      continue;
    }
    if (edgeIds.has(edge.id)) add('duplicate_edge_id', { edgeId: edge.id });
    edgeIds.add(edge.id);
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      add('edge_dangling', { edgeId: edge.id });
      continue;
    }
    if (edge.from === edge.to) add('edge_self_loop', { edgeId: edge.id, nodeId: edge.from });
    const pair = `${edge.from}>${edge.to}>${edge.outcome ?? ''}`;
    if (pairs.has(pair)) add('edge_duplicate', { edgeId: edge.id, nodeId: edge.from });
    pairs.add(pair);
    if (edge.label !== undefined && !isText(edge.label, WORKFLOW_LIMITS.maxNameLength)) add('edge_malformed', { edgeId: edge.id });
    if (edge.outcome !== undefined && edge.outcome !== '' && !(typeof edge.outcome === 'string' && OUTCOME.test(edge.outcome)))
      add('edge_bad_outcome', { edgeId: edge.id });
    if (edge.default !== undefined && typeof edge.default !== 'boolean') add('edge_malformed', { edgeId: edge.id });
    if (edge.condition !== undefined && edge.condition !== null) {
      const problem = predicateProblem(edge.condition);
      if (problem) add(problem, { edgeId: edge.id, nodeId: edge.from });
    }
    if (edge.waypoints !== undefined) {
      if (!Array.isArray(edge.waypoints) || edge.waypoints.length > WORKFLOW_LIMITS.maxWaypoints || !edge.waypoints.every(isPoint))
        add('edge_malformed', { edgeId: edge.id });
    }
  }

  if (trigger !== undefined) issues.push(...triggerShapeIssues(trigger));
  return issues;
}

function triggerShapeIssues(trigger: unknown): WorkflowIssue[] {
  const t = trigger as Partial<WorkflowTrigger> | null;
  if (!t || typeof t !== 'object' || (t.mode !== 'manual' && t.mode !== 'event')) {
    return [{ code: 'trigger_malformed', severity: 'error' }];
  }
  if (t.event !== undefined && !(typeof t.event === 'string' && t.event.length <= 120)) {
    return [{ code: 'trigger_malformed', severity: 'error' }];
  }
  if (t.filter !== undefined && t.filter !== null) {
    const problem = predicateProblem(t.filter);
    if (problem) return [{ code: problem, severity: 'error' }];
  }
  return [];
}

function configIssues(node: WorkflowGraphNode): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const config = node.config;
  const add = (code: string, params?: Record<string, string | number>) =>
    issues.push({ code, severity: 'error', nodeId: node.id, params });
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    add('config_malformed');
    return issues;
  }

  if (config.assigneeUserId !== undefined && config.assigneeUserId !== '' && !UUID.test(String(config.assigneeUserId)))
    add('assignee_user_invalid');
  if (config.assigneeRoleId !== undefined && config.assigneeRoleId !== '' && !UUID.test(String(config.assigneeRoleId)))
    add('assignee_role_invalid');
  if (config.escalateToUserId !== undefined && config.escalateToUserId !== '' && !UUID.test(String(config.escalateToUserId)))
    add('assignee_user_invalid');

  if (config.outcomes !== undefined) {
    if (!Array.isArray(config.outcomes) || config.outcomes.length > WORKFLOW_LIMITS.maxOutcomes) add('outcomes_invalid');
    else {
      if (config.outcomes.some((outcome) => typeof outcome !== 'string' || !OUTCOME.test(outcome))) add('outcomes_invalid');
      if (new Set(config.outcomes).size !== config.outcomes.length) add('outcomes_duplicate');
    }
  }
  if (config.outcomeLabels !== undefined) {
    if (
      typeof config.outcomeLabels !== 'object' ||
      config.outcomeLabels === null ||
      Object.values(config.outcomeLabels).some((value) => !isText(value, 80))
    )
      add('outcomes_invalid');
  }
  if (config.commentRequiredFor !== undefined && !(Array.isArray(config.commentRequiredFor) && config.commentRequiredFor.every((o) => typeof o === 'string')))
    add('outcomes_invalid');
  if (config.instructions !== undefined && !isText(config.instructions, WORKFLOW_LIMITS.maxTextLength)) add('text_too_long');
  if (config.form !== undefined) {
    if (!Array.isArray(config.form) || config.form.length > WORKFLOW_LIMITS.maxFormFields) add('form_invalid');
    else issues.push(...variableIssues(config.form, 'form').map((issue) => ({ ...issue, nodeId: node.id })));
  }
  if (config.dueInHours !== undefined && config.dueInHours !== null) {
    if (!isFiniteNumber(config.dueInHours) || config.dueInHours <= 0 || config.dueInHours > WORKFLOW_LIMITS.maxDueHours)
      add('due_hours_invalid', { max: WORKFLOW_LIMITS.maxDueHours });
  }
  if (config.timerMinutes !== undefined && config.timerMinutes !== null) {
    if (!isFiniteNumber(config.timerMinutes) || config.timerMinutes <= 0 || config.timerMinutes > WORKFLOW_LIMITS.maxTimerMinutes)
      add('timer_minutes_invalid', { max: WORKFLOW_LIMITS.maxTimerMinutes });
  }
  if (config.timerUntilVar !== undefined && config.timerUntilVar !== '' && !VARIABLE_NAME.test(String(config.timerUntilVar)))
    add('variable_name_invalid');
  if (config.action !== undefined && config.action !== '' && !(typeof config.action === 'string' && config.action.length <= 64))
    add('config_malformed');
  if (config.actionParams !== undefined) {
    if (typeof config.actionParams !== 'object' || config.actionParams === null || Array.isArray(config.actionParams))
      add('config_malformed');
    else if (JSON.stringify(config.actionParams).length > WORKFLOW_LIMITS.maxContextBytes) add('text_too_long');
  }
  return issues;
}

function variableIssues(variables: WorkflowVariable[], scope: 'variable' | 'form'): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const names = new Set<string>();
  const code = scope === 'form' ? 'form_invalid' : 'variables_malformed';
  for (const variable of variables) {
    if (!variable || typeof variable !== 'object' || typeof variable.name !== 'string' || !VARIABLE_NAME.test(variable.name)) {
      issues.push({ code: 'variable_name_invalid', severity: 'error' });
      continue;
    }
    if (names.has(variable.name)) issues.push({ code: 'variable_duplicate', severity: 'error', params: { name: variable.name } });
    names.add(variable.name);
    if (!WORKFLOW_VARIABLE_TYPES.includes(variable.type)) issues.push({ code, severity: 'error' });
    if (variable.label !== undefined && !isText(variable.label, WORKFLOW_LIMITS.maxNameLength)) issues.push({ code, severity: 'error' });
    if (variable.description !== undefined && !isText(variable.description, 500)) issues.push({ code, severity: 'error' });
    if (variable.min !== undefined && !isFiniteNumber(variable.min)) issues.push({ code, severity: 'error' });
    if (variable.max !== undefined && !isFiniteNumber(variable.max)) issues.push({ code, severity: 'error' });
    if (isFiniteNumber(variable.min) && isFiniteNumber(variable.max) && variable.min > variable.max)
      issues.push({ code: 'variable_range_invalid', severity: 'error', params: { name: variable.name } });
    if (variable.type === 'select' && !(Array.isArray(variable.options) && variable.options.length > 0 && variable.options.every((o) => isText(o, 120))))
      issues.push({ code: 'select_needs_options', severity: 'error', params: { name: variable.name } });
  }
  return issues;
}

/** A non-null code when a predicate tree is malformed, too deep or too wide. */
export function predicateProblem(predicate: unknown): string | null {
  let leaves = 0;
  const walk = (node: unknown, depth: number): string | null => {
    if (depth > WORKFLOW_LIMITS.maxPredicateDepth) return 'condition_too_deep';
    if (!node || typeof node !== 'object' || Array.isArray(node)) return 'condition_malformed';
    const p = node as Record<string, unknown>;
    if ('all' in p || 'any' in p) {
      const list = (p['all'] ?? p['any']) as unknown;
      if (!Array.isArray(list) || list.length === 0) return 'condition_malformed';
      for (const child of list) {
        const problem = walk(child, depth + 1);
        if (problem) return problem;
      }
      return null;
    }
    if ('not' in p) return walk(p['not'], depth + 1);
    leaves += 1;
    if (leaves > WORKFLOW_LIMITS.maxPredicateLeaves) return 'condition_too_large';
    if (typeof p['var'] !== 'string' || !VARIABLE_NAME.test(p['var'])) return 'condition_bad_variable';
    if (!WORKFLOW_PREDICATE_OPS.includes(p['op'] as never)) return 'condition_bad_operator';
    if (!UNARY_PREDICATE_OPS.has(p['op'] as never) && (p['value'] === undefined || p['value'] === '')) return 'condition_missing_value';
    if ((p['op'] === 'in' || p['op'] === 'nin') && !Array.isArray(p['value'])) return 'condition_needs_list';
    return null;
  };
  return walk(predicate, 0);
}

/**
 * Everything that would make a published process fail, stall or misroute at runtime.
 *
 * Run at publish (and by the designer on demand). Errors block publishing; warnings are shown but do
 * not — a variable a condition reads that the container does not declare may still arrive from a
 * business event, so it is worth flagging, not refusing.
 */
export function semanticIssues(
  graph: WorkflowGraph,
  trigger: WorkflowTrigger,
  ctx: WorkflowValidationContext,
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [...structuralIssues(graph, trigger)];
  if (issues.some((issue) => FATAL_STRUCTURAL.has(issue.code))) return issues;

  const err = (code: string, extra: Partial<WorkflowIssue> = {}) => issues.push({ code, severity: 'error', ...extra });
  const warn = (code: string, extra: Partial<WorkflowIssue> = {}) => issues.push({ code, severity: 'warning', ...extra });

  const nodes = graph.nodes;
  const edges = graph.edges;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, WorkflowGraphEdge[]>();
  const incoming = new Map<string, WorkflowGraphEdge[]>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
  }

  // ── Shape ────────────────────────────────────────────────────────────────
  const starts = nodes.filter((node) => node.type === WorkflowNodeType.START);
  if (starts.length === 0) err('need_start');
  if (starts.length > 1) starts.slice(1).forEach((node) => err('one_start', { nodeId: node.id }));
  if (!nodes.some((node) => node.type === WorkflowNodeType.END)) err('need_end');

  for (const node of nodes) {
    const name = label(node);
    const out = outgoing.get(node.id) ?? [];
    const inc = incoming.get(node.id) ?? [];

    if (node.type === WorkflowNodeType.START && inc.length) err('start_has_incoming', { nodeId: node.id });
    if (node.type === WorkflowNodeType.END && out.length) err('end_has_outgoing', { nodeId: node.id, params: { node: name } });
    if (node.type !== WorkflowNodeType.END && out.length === 0) err('node_no_exit', { nodeId: node.id, params: { node: name } });
    if (node.type !== WorkflowNodeType.START && inc.length === 0) err('node_no_entry', { nodeId: node.id, params: { node: name } });

    const defaults = out.filter((edge) => edge.default);
    if (defaults.length > 1) err('multiple_defaults', { nodeId: node.id, params: { node: name } });

    switch (node.type) {
      case WorkflowNodeType.TASK:
      case WorkflowNodeType.APPROVAL: {
        const config = node.config ?? {};
        // The node's name becomes the task's title in every inbox and notification: without one
        // a person would be asked to act on an opaque identifier.
        if (!node.name?.trim()) err('task_needs_name', { nodeId: node.id });
        if (!config.assigneeUserId && !config.assigneeRoleId) err('task_no_assignee', { nodeId: node.id, params: { node: name } });
        if (config.assigneeUserId && !ctx.userIds.has(config.assigneeUserId))
          err('assignee_user_unknown', { nodeId: node.id, params: { node: name } });
        else if (config.assigneeUserId && ctx.actingUserIds && !ctx.actingUserIds.has(config.assigneeUserId))
          err('assignee_user_cannot_act', { nodeId: node.id, params: { node: name } });
        if (!config.assigneeUserId && config.assigneeRoleId) {
          if (!ctx.roleIds.has(config.assigneeRoleId)) err('assignee_role_unknown', { nodeId: node.id, params: { node: name } });
          else if (ctx.actingRoleIds && !ctx.actingRoleIds.has(config.assigneeRoleId))
            err('assignee_role_cannot_act', { nodeId: node.id, params: { node: name } });
          else if (ctx.roleMemberCounts && (ctx.roleMemberCounts.get(config.assigneeRoleId) ?? 0) === 0)
            warn('assignee_role_empty', { nodeId: node.id, params: { node: name } });
        }
        if (config.escalateToUserId && !ctx.userIds.has(config.escalateToUserId))
          err('assignee_user_unknown', { nodeId: node.id, params: { node: name } });
        const outcomes = effectiveOutcomes(node);
        const routed = new Set(out.map((edge) => edge.outcome).filter(Boolean));
        const hasFallback = defaults.length === 1 || (out.length === 1 && !out[0].outcome);
        for (const outcome of outcomes) {
          if (!routed.has(outcome) && !hasFallback)
            err('outcome_unrouted', { nodeId: node.id, params: { node: name, outcome } });
        }
        for (const edge of out) {
          if (edge.outcome && !outcomes.includes(edge.outcome))
            err('edge_unknown_outcome', { nodeId: node.id, edgeId: edge.id, params: { node: name, outcome: edge.outcome } });
          if (edge.condition) warn('condition_ignored', { nodeId: node.id, edgeId: edge.id, params: { node: name } });
        }
        for (const outcome of config.commentRequiredFor ?? []) {
          if (!outcomes.includes(outcome)) err('edge_unknown_outcome', { nodeId: node.id, params: { node: name, outcome } });
        }
        break;
      }
      case WorkflowNodeType.CONDITION: {
        if (out.length < 2) err('condition_needs_branches', { nodeId: node.id, params: { node: name } });
        if (defaults.length === 0) err('condition_needs_default', { nodeId: node.id, params: { node: name } });
        for (const edge of out) {
          if (!edge.default && !edge.condition)
            err('branch_needs_condition', { nodeId: node.id, edgeId: edge.id, params: { node: name, target: label(byId.get(edge.to)) } });
        }
        break;
      }
      case WorkflowNodeType.ACTION: {
        const key = node.config?.action;
        const schema = key ? ctx.actionParams(key) : undefined;
        if (!key || !schema) {
          err('unknown_action', { nodeId: node.id, params: { node: name } });
          break;
        }
        // An action that reports an outcome (a webhook's ok/error) must say where each one goes.
        // Falling through to «the only connection» once sent a failed call down the success path.
        const actionOutcomes = ctx.actionOutcomes?.(key) ?? [];
        if (actionOutcomes.length) {
          const routed = new Set(out.map((edge) => edge.outcome).filter(Boolean));
          const fallback = defaults.length === 1 || (out.length === 1 && !out[0].outcome);
          for (const outcome of actionOutcomes) {
            if (routed.has(outcome)) continue;
            if (!fallback) err('outcome_unrouted', { nodeId: node.id, params: { node: name, outcome } });
            else if (outcome === 'error') warn('action_error_unhandled', { nodeId: node.id, params: { node: name } });
          }
          for (const edge of out) {
            if (edge.outcome && !actionOutcomes.includes(edge.outcome))
              err('edge_unknown_outcome', { nodeId: node.id, edgeId: edge.id, params: { node: name, outcome: edge.outcome } });
          }
        } else {
          for (const edge of out) {
            if (edge.outcome) err('edge_unknown_outcome', { nodeId: node.id, edgeId: edge.id, params: { node: name, outcome: edge.outcome } });
          }
          if (out.length > 1 && !out.some((edge) => edge.default))
            err('action_ambiguous_exit', { nodeId: node.id, params: { node: name } });
        }
        const params = node.config?.actionParams ?? {};
        for (const param of schema) {
          const value = params[param.name];
          const empty = value === undefined || value === null || value === '';
          if (param.required && empty) {
            err('action_param_required', { nodeId: node.id, params: { node: name, param: param.name } });
            continue;
          }
          if (empty) continue;
          if (param.type === 'url') {
            if (!isHttpUrl(value)) err('action_param_url', { nodeId: node.id, params: { node: name, param: param.name } });
            else if (isPrivateUrl(String(value))) err('action_param_url_private', { nodeId: node.id, params: { node: name } });
            else if (!ctx.allowHttpWebhooks && String(value).toLowerCase().startsWith('http:'))
              err('action_param_url_https', { nodeId: node.id, params: { node: name } });
          }
          if (param.type === 'number' && !isFiniteNumber(Number(value))) err('action_param_number', { nodeId: node.id, params: { node: name, param: param.name } });
          if (param.type === 'user' && !ctx.userIds.has(String(value))) err('assignee_user_unknown', { nodeId: node.id, params: { node: name } });
          if (param.type === 'select' && param.options && !param.options.includes(String(value)))
            err('action_param_option', { nodeId: node.id, params: { node: name, param: param.name } });
          if (param.maxLength && typeof value === 'string' && value.length > param.maxLength)
            err('action_param_too_long', { nodeId: node.id, params: { node: name, param: param.name, max: param.maxLength } });
        }
        break;
      }
      case WorkflowNodeType.TIMER: {
        const config = node.config ?? {};
        if (!config.timerUntilVar && !(isFiniteNumber(config.timerMinutes) && config.timerMinutes > 0))
          err('timer_needs_duration', { nodeId: node.id, params: { node: name } });
        if (out.length > 1 && !out.some((edge) => edge.default)) err('action_ambiguous_exit', { nodeId: node.id, params: { node: name } });
        break;
      }
      default:
        break;
    }
  }

  // ── Reachability: from the start forward, and to an end backward ──────────────
  if (starts.length === 1) {
    const reachable = walk(starts[0].id, (id) => (outgoing.get(id) ?? []).map((edge) => edge.to));
    for (const node of nodes) {
      if (!reachable.has(node.id) && (incoming.get(node.id) ?? []).length > 0)
        err('node_unreachable', { nodeId: node.id, params: { node: label(node) } });
    }
    const ends = nodes.filter((node) => node.type === WorkflowNodeType.END).map((node) => node.id);
    const canFinish = new Set<string>();
    for (const end of ends) walk(end, (id) => (incoming.get(id) ?? []).map((edge) => edge.from)).forEach((id) => canFinish.add(id));
    for (const node of nodes) {
      if (reachable.has(node.id) && !canFinish.has(node.id) && node.type !== WorkflowNodeType.END)
        err('node_cannot_finish', { nodeId: node.id, params: { node: label(node) } });
    }
  }

  // ── Loops that never wait would spin until the step guard fails the instance ──
  for (const cycle of automaticCycles(nodes, outgoing)) {
    err('automatic_loop', { nodeId: cycle[0], params: { node: label(byId.get(cycle[0])) } });
  }

  // ── Variables ──────────────────────────────────────────────────────────────
  // A condition reading a variable nothing ever writes is not a style problem: the comparison is
  // always false, so the branch it guards can never be taken. On an approval threshold that means
  // every document is waved through. When the process's data is fully known (a manual start, or a
  // catalogued event whose payload is declared) that is an error; only for an integration event
  // whose payload nobody declared can it still be a warning.
  const eventFields = trigger.mode === 'event' && trigger.event ? ctx.eventFields?.(trigger.event) : [];
  const dataKnown = trigger.mode === 'manual' || eventFields !== undefined;
  const declared = new Set<string>([
    ...(graph.variables ?? []).map((variable) => variable.name),
    ...nodes.flatMap((node) => (node.config?.form ?? []).map((field) => field.name)),
    ...nodes.map((node) => node.id),
    ...(eventFields ?? []),
    ...nodes.flatMap((node) =>
      node.type === WorkflowNodeType.ACTION && node.config?.action
        ? [...(ctx.actionWrites?.(node.config.action, node.config.actionParams ?? {}) ?? [])]
        : [],
    ),
    ...ENGINE_VARIABLES,
  ]);
  const isDeclared = (path: string) => declared.has(path) || declared.has(path.split('.')[0]);
  const undeclared = (variable: string, extra: Partial<WorkflowIssue>) =>
    (dataKnown ? err : warn)('variable_undeclared', { ...extra, params: { variable } });
  for (const edge of edges) {
    for (const variable of predicateVariables(edge.condition)) {
      if (!isDeclared(variable)) undeclared(variable, { edgeId: edge.id, nodeId: edge.from });
    }
  }
  for (const node of nodes) {
    if (node.config?.timerUntilVar && !isDeclared(node.config.timerUntilVar))
      undeclared(node.config.timerUntilVar, { nodeId: node.id });
  }
  if (trigger.filter) {
    for (const variable of predicateVariables(trigger.filter)) {
      if (!isDeclared(variable)) undeclared(variable, {});
    }
  }

  // ── Trigger ───────────────────────────────────────────────────────────────
  if (trigger.mode === 'event') {
    if (!trigger.event?.trim()) err('trigger_needs_event');
    else if (!ctx.isKnownEvent(trigger.event)) err('trigger_unknown_event', { params: { event: trigger.event } });
  }

  return issues;
}

/** The outcomes a human node offers: its own, or the defaults its type implies. */
export function effectiveOutcomes(node: WorkflowGraphNode): string[] {
  const own = node.config?.outcomes?.filter(Boolean) ?? [];
  if (own.length) return own;
  return node.type === WorkflowNodeType.APPROVAL ? ['approve', 'reject'] : ['done'];
}

export function isHumanNode(node: WorkflowGraphNode): boolean {
  return HUMAN.has(node.type);
}

function walk(start: string, next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const target of next(id)) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

/** Strongly connected components made only of automatic nodes (Tarjan), each a loop with no wait. */
function automaticCycles(nodes: WorkflowGraphNode[], outgoing: Map<string, WorkflowGraphEdge[]>): string[][] {
  const automatic = new Set(nodes.filter((node) => !WAITING.has(node.type)).map((node) => node.id));
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const strong = (id: string) => {
    indices.set(id, index);
    low.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (!automatic.has(edge.to)) continue;
      if (!indices.has(edge.to)) {
        strong(edge.to);
        low.set(id, Math.min(low.get(id) as number, low.get(edge.to) as number));
      } else if (onStack.has(edge.to)) {
        low.set(id, Math.min(low.get(id) as number, indices.get(edge.to) as number));
      }
    }
    if (low.get(id) === indices.get(id)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      const selfLoop = (outgoing.get(id) ?? []).some((edge) => edge.to === id);
      if (component.length > 1 || selfLoop) cycles.push(component);
    }
  };

  for (const id of automatic) if (!indices.has(id)) strong(id);
  return cycles;
}

function isText(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length <= max;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): boolean {
  const point = value as { x?: unknown; y?: unknown } | null;
  return (
    !!point &&
    typeof point === 'object' &&
    isFiniteNumber(point.x) &&
    isFiniteNumber(point.y) &&
    Math.abs(point.x) < 1e6 &&
    Math.abs(point.y) < 1e6
  );
}

/** A literal loopback/private/link-local address or a local host name — never reachable safely. */
export function isPrivateUrl(value: string): boolean {
  let host: string;
  try {
    host = new URL(value).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (host.includes(':')) return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  return false;
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export type { WorkflowPredicate };
