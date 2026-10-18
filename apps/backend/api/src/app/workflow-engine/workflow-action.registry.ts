import { Injectable, Logger } from '@nestjs/common';
import { WorkflowActionParam } from './validation/workflow-graph.validator';
import { WorkflowSubject } from './contracts/workflow-graph';

/** What a running action is handed: the instance it belongs to, the live context, and its parameters. */
export interface WorkflowActionContext {
  organizationId: string;
  instanceId: string;
  nodeId: string;
  /** The instance's variables. Read-only here; return a `patch` to change them. */
  context: Record<string, unknown>;
  /** Static parameters configured on the node in the designer. */
  params: Record<string, unknown>;
  /** Who started the instance, the default target for a notification. */
  startedByUserId: string | null;
  /** The instance's subject label, for messages. */
  subjectLabel: string | null;
  /** What the instance is about (type and id of the business document), when it has one. */
  subject: WorkflowSubject | null;
}

export interface WorkflowActionResult {
  /** An outcome that selects the outgoing edge, as a task's outcome would. Optional. */
  outcome?: string;
  /** Variables to merge into the instance context. */
  patch?: Record<string, unknown>;
  /** A short, human-readable line for the instance timeline. */
  summary?: string;
  /** A catalogue key for the timeline line, preferred over `summary` by the client. */
  summaryKey?: string;
  summaryParams?: Record<string, string | number>;
}

/**
 * An automatic step the engine can run.
 *
 * The registry is the seam that keeps the engine from importing any operational module: the engine
 * knows how to *run* an action by key, and each owner registers what its key *does* — exactly the
 * inversion the approval `ApprovalHandlerRegistry` uses, for the same reason. The built-in set
 * (log, set a variable, notify, call a webhook) ships here; a module can add «post this invoice» or
 * «reserve this stock» later without the engine ever learning their names.
 *
 * `params` is the action's contract with the designer: the panel renders a form from it, and
 * publishing refuses a node whose required parameters are missing or malformed.
 */
export interface WorkflowAction {
  readonly key: string;
  /** i18n key for the action's name in the designer palette. */
  readonly labelKey: string;
  /** i18n key for a one-line description shown under the selector. */
  readonly descriptionKey?: string;
  /** Outcomes the action may return, so the designer can offer them on outgoing connections. */
  readonly outcomes?: readonly string[];
  readonly params: readonly WorkflowActionParam[];
  /** Context variables the action writes when it runs, so validation knows they will exist. */
  writes?(params: Record<string, unknown>): readonly string[];
  run(context: WorkflowActionContext): Promise<WorkflowActionResult>;
}

export interface WorkflowActionCatalogueItem {
  key: string;
  labelKey: string;
  descriptionKey: string | null;
  outcomes: string[];
  params: WorkflowActionParam[];
}

@Injectable()
export class WorkflowActionRegistry {
  private readonly logger = new Logger(WorkflowActionRegistry.name);
  private readonly actions = new Map<string, WorkflowAction>();

  register(action: WorkflowAction): void {
    if (this.actions.has(action.key)) {
      this.logger.warn(`La acción «${action.key}» se registró más de una vez; gana la última.`);
    }
    this.actions.set(action.key, action);
  }

  get(key: string): WorkflowAction | undefined {
    return this.actions.get(key);
  }

  paramsOf(key: string): readonly WorkflowActionParam[] | undefined {
    return this.actions.get(key)?.params;
  }

  writesOf(key: string, params: Record<string, unknown>): readonly string[] {
    return this.actions.get(key)?.writes?.(params) ?? [];
  }

  /** The palette: every action the designer may place, with the form its parameters need. */
  catalogue(): WorkflowActionCatalogueItem[] {
    return [...this.actions.values()]
      .map((action) => ({
        key: action.key,
        labelKey: action.labelKey,
        descriptionKey: action.descriptionKey ?? null,
        outcomes: [...(action.outcomes ?? [])],
        params: action.params.map((param) => ({ ...param })),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }
}
