/**
 * The shape of a business workflow — SAP Business Workflow / Camunda-style process, modelled as a
 * directed graph the designer draws and the engine executes.
 *
 * A definition's `graph` is one of these, stored as JSON. It is deliberately data, not code: the
 * engine interprets it, the designer edits it, and a condition is a {@link WorkflowPredicate} tree
 * rather than a string of code — safe to store, safe to evaluate, and buildable in a form. That is
 * the choice that lets a non-developer author a process without opening a door to arbitrary
 * execution on the server.
 *
 * Everything the designer needs to round-trip the author's drawing (positions, waypoints, lanes,
 * the chosen connection style) lives here too, so a process reopens exactly as it was left. The
 * engine ignores those presentation fields.
 */

export enum WorkflowNodeType {
  /** The single entry point. Exactly one per graph. */
  START = 'start',
  /** A terminal. A token that reaches one is consumed; when the last is, the instance completes. */
  END = 'end',
  /** Human work: a task assigned to a role or user, waiting on an outcome. */
  TASK = 'task',
  /** A human decision, modelled as a task whose outcomes approve or reject. */
  APPROVAL = 'approval',
  /** An exclusive gateway: the first outgoing edge whose predicate holds is taken. */
  CONDITION = 'condition',
  /** Automatic work: a registered action runs, then the flow continues. */
  ACTION = 'action',
  /** A wait: the token parks until a duration elapses or a dated variable is reached. */
  TIMER = 'timer',
}

export const WORKFLOW_NODE_TYPES: readonly WorkflowNodeType[] = Object.values(WorkflowNodeType);

/** Comparison operators a condition leaf may use. */
export const WORKFLOW_PREDICATE_OPS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'exists',
  'not_exists',
  'truthy',
  'falsy',
] as const;

export type WorkflowPredicateOp = (typeof WORKFLOW_PREDICATE_OPS)[number];

/** Operators that take no right-hand operand. */
export const UNARY_PREDICATE_OPS: ReadonlySet<WorkflowPredicateOp> = new Set([
  'exists',
  'not_exists',
  'truthy',
  'falsy',
]);

/** A leaf comparison or a boolean combination — the whole of a condition, with no code in it. */
export type WorkflowPredicate =
  | { all: WorkflowPredicate[] }
  | { any: WorkflowPredicate[] }
  | { not: WorkflowPredicate }
  | {
      /** Dotted path into the instance context, e.g. `amount` or `invoice.total`. */
      var: string;
      op: WorkflowPredicateOp;
      /** The right-hand operand. Absent for unary operators. */
      value?: unknown;
    };

/** The data types a process variable (or a task form field) can hold. */
export const WORKFLOW_VARIABLE_TYPES = ['string', 'text', 'number', 'boolean', 'date', 'select', 'user'] as const;
export type WorkflowVariableType = (typeof WORKFLOW_VARIABLE_TYPES)[number];

/**
 * A named piece of process data — SAP's «workflow container» element.
 *
 * Declared on the definition, variables drive the start form, the condition editor's variable
 * picker and validation; declared on a task (`config.form`), they are what the actor fills in when
 * deciding, merged into the instance context.
 */
export interface WorkflowVariable {
  /** Identifier used in conditions and the context (`amount`, `invoice.total`). */
  name: string;
  /** Human label shown in forms. */
  label?: string;
  type: WorkflowVariableType;
  required?: boolean;
  /** For `select`. */
  options?: string[];
  /** Shown in forms as a hint. */
  description?: string;
}

export interface WorkflowNodeConfig {
  /** The role whose holders may act on the task. */
  assigneeRoleId?: string;
  /** A specific user the task is assigned to, taking precedence over the role. */
  assigneeUserId?: string;
  /** The outcomes the actor may choose, each matching an outgoing edge's `outcome`. */
  outcomes?: string[];
  /** Human labels for outcomes (`{ approve: 'Aprobar' }`). Missing ones fall back to the catalogue. */
  outcomeLabels?: Record<string, string>;
  /** Outcomes that ask for a comment before they are accepted (typically a rejection). */
  commentRequiredFor?: string[];
  /** Fields the actor fills in when completing the task, merged into the context. */
  form?: WorkflowVariable[];
  /** Instructions shown to the actor in the inbox. */
  instructions?: string;
  /** Hours from creation after which the task is overdue (for the inbox and escalation). */
  dueInHours?: number;
  /** Who is told when the task goes overdue. Defaults to the instance's starter. */
  escalateToUserId?: string;

  /** The registered action key (see `WorkflowActionRegistry`). */
  action?: string;
  /** Static parameters passed to the action, merged with the live context. */
  actionParams?: Record<string, unknown>;

  /** Minutes to wait from the moment the token arrives. */
  timerMinutes?: number;
  /** A context path holding an ISO date/time to wait until (takes precedence over `timerMinutes`). */
  timerUntilVar?: string;
}

export interface WorkflowPoint {
  x: number;
  y: number;
}

export interface WorkflowGraphNode {
  id: string;
  type: WorkflowNodeType;
  /** Human label, shown on the node and used to name the task it creates. */
  name?: string;
  /** Free text for the author; not shown to actors. */
  description?: string;
  /** Canvas coordinates, kept so the designer round-trips the layout the author arranged. */
  position?: WorkflowPoint;
  /** The lane (group) the node sits in, if any. Presentation only. */
  parentId?: string;
  config?: WorkflowNodeConfig;
}

export interface WorkflowGraphEdge {
  id: string;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  label?: string;
  /** Match a task/approval outcome: the edge is taken when the task completes with this outcome. */
  outcome?: string;
  /** For a condition gateway (or a conditional flow): the edge is taken when this holds. */
  condition?: WorkflowPredicate;
  /** The fallback edge, taken when no outcome/condition edge applies. At most one per node. */
  default?: boolean;
  /** Bend points the author dragged onto the connection. Presentation only. */
  waypoints?: WorkflowPoint[];
}

/** A lane / swimlane: a labelled region grouping nodes, typically one per department or role. */
export interface WorkflowGraphGroup {
  id: string;
  name?: string;
  position?: WorkflowPoint;
  size?: { width: number; height: number };
  /** One of the designer's lane colours. */
  color?: string;
}

/** Designer preferences saved with the drawing. */
export interface WorkflowGraphSettings {
  connectionType?: 'segment' | 'straight' | 'bezier' | 'adaptive-curve';
  layoutDirection?: 'LR' | 'TB';
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  groups?: WorkflowGraphGroup[];
  /** The process container: data the instance carries, declared up front. */
  variables?: WorkflowVariable[];
  settings?: WorkflowGraphSettings;
}

/** How a definition is started. */
export interface WorkflowTrigger {
  mode: 'manual' | 'event';
  /** For `event`: the business event name that starts an instance, e.g. `invoice.issued`. */
  event?: string;
  /** For `event`: an optional predicate over the event's context that must hold to start. */
  filter?: WorkflowPredicate;
}

export type WorkflowTokenState = 'active' | 'waiting' | 'done';

/**
 * A point of execution inside a running instance.
 *
 * The engine advances every `active` token until each is `waiting` (parked on a task or timer) or
 * `done`. Tokens are a list rather than a single cursor so the model can carry more than one path
 * at once without a change to how an instance is stored.
 */
export interface WorkflowToken {
  id: string;
  nodeId: string;
  state: WorkflowTokenState;
  /** Why a `waiting` token is parked. */
  waitKind?: 'task' | 'timer';
  /** For a parked timer token: when it should resume (ISO). */
  wakeAt?: string;
}

/** What a running instance is about, for the inbox and the audit trail. Free-form by design. */
export interface WorkflowSubject {
  type?: string;
  id?: string;
  label?: string;
  /** Where the subject lives in the client (`/invoices/<id>`), for a link from the inbox. */
  route?: string;
}

/** Limits that keep one definition from becoming a denial of service for the tenant. */
export const WORKFLOW_LIMITS = {
  maxNodes: 500,
  maxEdges: 2000,
  maxGroups: 100,
  maxVariables: 100,
  maxOutcomes: 12,
  maxFormFields: 40,
  maxWaypoints: 50,
  maxPredicateDepth: 8,
  maxPredicateLeaves: 64,
  maxNameLength: 200,
  maxIdLength: 64,
  maxTextLength: 4000,
  maxDueHours: 24 * 365,
  maxTimerMinutes: 60 * 24 * 365,
  maxContextBytes: 64 * 1024,
} as const;
