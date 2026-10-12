import { Injectable, Logger } from '@nestjs/common';

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
}

export interface WorkflowActionResult {
  /** An outcome that selects the outgoing edge, as a task's outcome would. Optional. */
  outcome?: string;
  /** Variables to merge into the instance context. */
  patch?: Record<string, unknown>;
}

/**
 * An automatic step the engine can run.
 *
 * The registry is the seam that keeps the engine from importing any operational module: the engine
 * knows how to *run* an action by key, and each owner registers what its key *does* — exactly the
 * inversion the approval `ApprovalHandlerRegistry` uses, for the same reason. The built-in set
 * (log, set a variable, notify, call a webhook) ships here; a module can add «post this invoice» or
 * «reserve this stock» later without the engine ever learning their names.
 */
export interface WorkflowAction {
  readonly key: string;
  /** i18n key for the action's name in the designer palette. */
  readonly labelKey: string;
  run(context: WorkflowActionContext): Promise<WorkflowActionResult>;
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

  /** The palette: every action the designer may place, as `{ key, labelKey }`. */
  catalogue(): Array<{ key: string; labelKey: string }> {
    return [...this.actions.values()].map((action) => ({ key: action.key, labelKey: action.labelKey }));
  }
}
