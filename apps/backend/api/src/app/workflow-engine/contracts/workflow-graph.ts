/**
 * The shape of a business workflow — SAP Business Workflow / Camunda-style process, modelled as a
 * directed graph the designer draws and the engine executes.
 *
 * A definition's `graph` is one of these, stored as JSON. It is deliberately data, not code: the
 * engine interprets it, the designer edits it, and a condition is a {@link WorkflowPredicate} tree
 * rather than a string of code — safe to store, safe to evaluate, and buildable in a form. That is
 * the choice that lets a non-developer author a process without opening a door to arbitrary
 * execution on the server.
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

/** A leaf comparison or a boolean combination — the whole of a condition, with no code in it. */
export type WorkflowPredicate =
  | { all: WorkflowPredicate[] }
  | { any: WorkflowPredicate[] }
  | { not: WorkflowPredicate }
  | {
      /** Dotted path into the instance context, e.g. `amount` or `invoice.total`. */
      var: string;
      op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'exists' | 'truthy';
      /** The right-hand operand. Absent for `exists`/`truthy`. */
      value?: unknown;
    };

export interface WorkflowNodeConfig {
  // — TASK / APPROVAL —
  /** The role whose holders may act on the task. */
  assigneeRoleId?: string;
  /** A specific user the task is assigned to, taking precedence over the role. */
  assigneeUserId?: string;
  /** The outcomes the actor may choose, each matching an outgoing edge's `outcome`. */
  outcomes?: string[];
  /** Hours from creation after which the task is overdue (for the inbox and escalation). */
  dueInHours?: number;

  // — ACTION —
  /** The registered action key (see `WorkflowActionRegistry`). */
  action?: string;
  /** Static parameters passed to the action, merged with the live context. */
  actionParams?: Record<string, unknown>;

  // — TIMER —
  /** Minutes to wait from the moment the token arrives. */
  timerMinutes?: number;
  /** A context path holding an ISO date/time to wait until (takes precedence over `timerMinutes`). */
  timerUntilVar?: string;
}

export interface WorkflowGraphNode {
  id: string;
  type: WorkflowNodeType;
  /** Human label, shown on the node and used to name the task it creates. */
  name?: string;
  /** Canvas coordinates, kept so the designer round-trips the layout the author arranged. */
  position?: { x: number; y: number };
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
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

/** How a definition is started. */
export interface WorkflowTrigger {
  mode: 'manual' | 'event';
  /** For `event`: the business event name that starts an instance, e.g. `invoice.created`. */
  event?: string;
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
}
