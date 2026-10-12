import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, LessThanOrEqual } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from '../i18n/localized.exception';
import {
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowNodeType,
  WorkflowSubject,
  WorkflowToken,
} from './contracts/workflow-graph';
import { evaluatePredicate } from './contracts/workflow-predicate';
import { coerceFields, contextTooLarge, sanitizeContext } from './contracts/workflow-context';
import { WorkflowDefinition } from './entities/workflow-definition.entity';
import { WorkflowInstance, WorkflowInstanceStatus } from './entities/workflow-instance.entity';
import { WorkflowTask, WorkflowTaskStatus } from './entities/workflow-task.entity';
import { WorkflowTransition, WorkflowTransitionKind } from './entities/workflow-transition.entity';
import { WorkflowActionRegistry } from './workflow-action.registry';
import { WorkflowNotifier } from './workflow-notifier.service';
import { effectiveOutcomes } from './validation/workflow-graph.validator';

/** The guard against a mis-authored loop: no instance advances more than this many steps in one run. */
const MAX_STEPS_PER_RUN = 1000;
/** How deep subprocesses may nest before the engine refuses to start another. */
export const MAX_SUBPROCESS_DEPTH = 5;
/** How many due timers or overdue tasks one sweep handles per tenant, so one tenant cannot starve the rest. */
const SWEEP_BATCH = 200;

export interface StartOptions {
  context?: Record<string, unknown>;
  subject?: WorkflowSubject | null;
  startedByUserId?: string | null;
  parentInstanceId?: string | null;
}

export interface TaskActor {
  userId: string;
  roleIds: readonly string[];
}

export interface CompleteTaskOptions {
  outcome: string;
  formData?: Record<string, unknown>;
  comment?: string | null;
}

/** Work done after the transaction commits — notifications must never announce a rolled-back step. */
type Effect = () => Promise<void>;

/** Everything one advance of an instance shares: its transaction and its post-commit effects. */
interface RunScope {
  tx: EntityManager;
  effects: Effect[];
  actorUserId: string | null;
  /** End nodes reached during this run, for the instance result. */
  endsReached: string[];
}

/**
 * The execution engine for business workflows.
 *
 * It advances an instance by moving its tokens through the definition's graph: automatic nodes run
 * and move on in the same breath, a condition picks the first branch whose predicate holds, and a
 * human node parks its token on a {@link WorkflowTask} until someone completes it.
 *
 * ## Concurrency
 *
 * Every state change — start, complete, cancel, retry, timer resume — runs in one transaction that
 * first takes a row lock on the instance (`SELECT … FOR UPDATE`). Two people pressing «approve» at
 * the same moment, a double click, or a timer sweep racing a completion therefore serialise: the
 * second waits for the first, re-reads, sees the task closed and gets a 409 instead of advancing the
 * process twice and running its actions twice. The timer sweep uses `SKIP LOCKED`, so a busy
 * instance is simply picked up on the next tick.
 *
 * ## Failure
 *
 * An error inside a node (a missing action, an action that threw) does not escape: the instance is
 * marked FAILED with the reason, its tokens stay where they were, and `retry` resumes it from that
 * exact step once the cause is fixed. Notifications and other side effects run only after commit.
 *
 * Every query runs under the row-level policies — in a request through the interceptor's context,
 * in the sweeps through `runAsTenantJob` — so an instance never crosses a company boundary.
 */
@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly actions: WorkflowActionRegistry,
    private readonly notifier: WorkflowNotifier,
  ) {}

  // ── Starting ───────────────────────────────────────────────────────────────

  async start(definition: WorkflowDefinition, options: StartOptions, organizationId: string): Promise<WorkflowInstance> {
    const startNode = definition.graph.nodes.find((node) => node.type === WorkflowNodeType.START);
    if (!startNode) throw new BadRequestError('workflow_engine.no_start_node');

    let context = sanitizeContext(options.context ?? {});
    const declared = definition.graph.variables ?? [];
    if (declared.length) {
      const checked = coerceFields(declared, context);
      if (checked.problems.length) {
        throw new UnprocessableEntityError('workflow_engine.start_form_invalid', {
          field: checked.problems[0].field,
          problems: checked.problems,
        });
      }
      context = checked.values;
    }
    if (contextTooLarge(context)) throw new BadRequestError('workflow_engine.context_too_large');
    const depth = Number(context['__workflowDepth'] ?? 0);
    if (depth > MAX_SUBPROCESS_DEPTH) throw new BadRequestError('workflow_engine.subprocess_too_deep');

    return this.transaction(async (scope) => {
      const instances = scope.tx.getRepository(WorkflowInstance);
      const token: WorkflowToken = { id: uuidv4(), nodeId: startNode.id, state: 'active' };
      const created = await instances.save(
        instances.create({
          organizationId,
          definitionId: definition.id,
          definitionVersion: definition.version,
          status: WorkflowInstanceStatus.RUNNING,
          context,
          tokens: [token],
          subject: sanitizeSubject(options.subject),
          startedByUserId: options.startedByUserId ?? null,
          parentInstanceId: options.parentInstanceId ?? null,
          nextWakeAt: null,
          error: null,
          result: null,
          cancelReason: null,
          completedAt: null,
        }),
      );
      await this.record(scope, created, 'started', {
        toNodeId: startNode.id,
        actorUserId: options.startedByUserId ?? null,
        detail: { definitionVersion: definition.version, nodeName: startNode.name ?? null },
      });
      return this.run(scope, created, definition);
    }, options.startedByUserId ?? null);
  }

  // ── Completing a human task ───────────────────────────────────────────────────

  /**
   * Decide a task: validate who may, with what outcome and data, then advance its instance.
   *
   * The task row is locked and re-read inside the transaction, so of two concurrent completions
   * exactly one wins and the other gets `task_already_completed` (409) — never a second advance.
   */
  async completeTask(taskId: string, organizationId: string, options: CompleteTaskOptions, actor: TaskActor): Promise<WorkflowInstance> {
    return this.transaction(async (scope) => {
      const tasks = scope.tx.getRepository(WorkflowTask);
      const task = await tasks.findOne({
        where: { id: taskId, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) throw new NotFoundError('workflow_engine.task_not_found');
      if (task.status !== WorkflowTaskStatus.OPEN) {
        throw new ConflictError('workflow_engine.task_already_completed', {}, 'workflow_engine.task_already_completed');
      }
      assertCanAct(task, actor);

      if (task.outcomes.length > 0 && !task.outcomes.includes(options.outcome)) {
        throw new BadRequestError('workflow_engine.invalid_outcome', { outcome: options.outcome });
      }
      const comment = options.comment?.trim() ? options.comment.trim().slice(0, 4000) : null;
      if ((task.commentRequiredFor ?? []).includes(options.outcome) && !comment) {
        throw new UnprocessableEntityError('workflow_engine.comment_required', { outcome: options.outcome });
      }
      let formData = sanitizeContext(options.formData ?? {});
      if (task.form?.length) {
        const checked = coerceFields(task.form, formData);
        if (checked.problems.length) {
          throw new UnprocessableEntityError('workflow_engine.task_form_invalid', { field: checked.problems[0].field });
        }
        // Only declared fields cross into the context: a task form is not a way to overwrite
        // arbitrary process variables.
        const allowed = new Set(task.form.map((field) => field.name));
        formData = Object.fromEntries(Object.entries(checked.values).filter(([key]) => allowed.has(key)));
      } else {
        formData = {};
      }

      const instance = await this.lockInstance(scope.tx, task.instanceId, organizationId);
      if (instance.status !== WorkflowInstanceStatus.RUNNING) {
        throw new ConflictError('workflow_engine.instance_not_running');
      }
      const definition = await this.loadDefinition(scope.tx, instance);

      task.status = WorkflowTaskStatus.COMPLETED;
      task.outcome = options.outcome;
      task.completedByUserId = actor.userId;
      task.completedAt = new Date();
      task.formData = Object.keys(formData).length ? formData : null;
      task.comment = comment;
      await tasks.save(task);
      scope.effects.push(() => this.notifier.taskClosed(task));

      // The outcome and whatever the actor filled in become context the rest of the flow can read.
      instance.context = {
        ...instance.context,
        ...formData,
        [task.nodeId]: { outcome: options.outcome, comment, by: actor.userId, at: task.completedAt.toISOString() },
        lastOutcome: options.outcome,
        lastComment: comment,
      };
      if (contextTooLarge(instance.context)) throw new BadRequestError('workflow_engine.context_too_large');

      const token = instance.tokens.find((candidate) => candidate.id === task.tokenId);
      const node = nodeOf(definition.graph, task.nodeId);
      const edge = node ? pickEdge(definition.graph, node, { outcome: options.outcome }) : undefined;
      await this.record(scope, instance, 'task_completed', {
        fromNodeId: task.nodeId,
        toNodeId: edge?.to ?? null,
        actorUserId: actor.userId,
        detail: {
          taskId: task.id,
          nodeName: task.name,
          outcome: options.outcome,
          outcomeLabel: task.outcomeLabels?.[options.outcome] ?? null,
          comment,
          nextNodeName: edge ? (nodeOf(definition.graph, edge.to)?.name ?? null) : null,
        },
      });
      if (token) follow(token, edge);
      return this.run(scope, instance, definition);
    }, actor.userId);
  }

  // ── Cancelling and retrying ─────────────────────────────────────────────────

  async cancel(instanceId: string, organizationId: string, actorUserId: string, reason: string): Promise<WorkflowInstance> {
    const text = reason?.trim();
    if (!text) throw new BadRequestError('workflow_engine.cancel_reason_required');
    return this.transaction(async (scope) => {
      const instance = await this.lockInstance(scope.tx, instanceId, organizationId);
      if (instance.status !== WorkflowInstanceStatus.RUNNING && instance.status !== WorkflowInstanceStatus.FAILED) {
        throw new ConflictError('workflow_engine.instance_not_running');
      }
      instance.status = WorkflowInstanceStatus.CANCELLED;
      instance.completedAt = new Date();
      instance.nextWakeAt = null;
      instance.cancelReason = text.slice(0, 2000);
      instance.tokens = instance.tokens.map((token) => ({ ...token, state: 'done' as const }));
      await scope.tx.getRepository(WorkflowInstance).save(instance);
      const open = await scope.tx.getRepository(WorkflowTask).find({
        where: { instanceId: instance.id, organizationId, status: WorkflowTaskStatus.OPEN },
      });
      for (const task of open) {
        task.status = WorkflowTaskStatus.CANCELLED;
        task.completedAt = new Date();
        task.completedByUserId = actorUserId;
        await scope.tx.getRepository(WorkflowTask).save(task);
        scope.effects.push(() => this.notifier.taskClosed(task));
      }
      await this.record(scope, instance, 'cancelled', { actorUserId, detail: { reason: instance.cancelReason } });
      return instance;
    }, actorUserId);
  }

  /** Resume a FAILED instance from the step that failed, once its cause has been fixed. */
  async retry(instanceId: string, organizationId: string, actorUserId: string): Promise<WorkflowInstance> {
    return this.transaction(async (scope) => {
      const instance = await this.lockInstance(scope.tx, instanceId, organizationId);
      if (instance.status !== WorkflowInstanceStatus.FAILED) throw new ConflictError('workflow_engine.instance_not_failed');
      const definition = await this.loadDefinition(scope.tx, instance);
      const previous = instance.error;
      instance.status = WorkflowInstanceStatus.RUNNING;
      instance.error = null;
      await this.record(scope, instance, 'retried', { actorUserId, detail: { previousError: previous } });
      return this.run(scope, instance, definition);
    }, actorUserId);
  }

  // ── Sweeps (called per tenant by the cron) ────────────────────────────────────

  /** Resume every running instance whose earliest parked timer is due. Returns how many advanced. */
  async resumeDueTimers(organizationId: string, now: Date = new Date()): Promise<number> {
    const due = await this.dataSource.getRepository(WorkflowInstance).find({
      select: { id: true },
      where: { organizationId, status: WorkflowInstanceStatus.RUNNING, nextWakeAt: LessThanOrEqual(now) },
      order: { nextWakeAt: 'ASC' },
      take: SWEEP_BATCH,
    });

    let resumed = 0;
    for (const { id } of due) {
      try {
        const advanced = await this.transaction(async (scope) => {
          const instance = await scope.tx.getRepository(WorkflowInstance).findOne({
            where: { id, organizationId },
            lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
          });
          // Someone else holds it, or it moved on since the scan: the next tick will see it.
          if (!instance || instance.status !== WorkflowInstanceStatus.RUNNING) return false;
          const definition = await this.loadDefinition(scope.tx, instance);

          let woke = false;
          for (const token of instance.tokens) {
            if (token.state !== 'waiting' || token.waitKind !== 'timer' || !token.wakeAt || new Date(token.wakeAt) > now) continue;
            const node = nodeOf(definition.graph, token.nodeId);
            const edge = node ? pickEdge(definition.graph, node, {}) : undefined;
            await this.record(scope, instance, 'timer_fired', {
              fromNodeId: token.nodeId,
              toNodeId: edge?.to ?? null,
              detail: { nodeName: node?.name ?? null, wakeAt: token.wakeAt },
            });
            // The wait is over: the token leaves the timer node along its exit, rather than being
            // re-activated on the timer itself — which would park it again for another full wait.
            follow(token, edge);
            woke = true;
          }
          if (!woke) {
            this.recomputeWake(instance);
            await scope.tx.getRepository(WorkflowInstance).save(instance);
            return false;
          }
          await this.run(scope, instance, definition);
          return true;
        }, null);
        if (advanced) resumed += 1;
      } catch (error) {
        this.logger.error(`No se pudo reanudar la instancia ${id}: ${(error as Error)?.message ?? error}`);
      }
    }
    return resumed;
  }

  /** Remind the assignee (and whoever the node names) once a task passes its due date. */
  async escalateOverdue(organizationId: string, now: Date = new Date()): Promise<number> {
    const overdue = await this.dataSource.getRepository(WorkflowTask).find({
      where: { organizationId, status: WorkflowTaskStatus.OPEN, dueAt: LessThanOrEqual(now), escalatedAt: IsNull() },
      take: SWEEP_BATCH,
    });
    let count = 0;
    for (const candidate of overdue) {
      const done = await this.transaction(async (scope) => {
        const task = await scope.tx.getRepository(WorkflowTask).findOne({
          where: { id: candidate.id, organizationId },
          lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
        });
        if (!task || task.status !== WorkflowTaskStatus.OPEN || task.escalatedAt) return false;
        task.escalatedAt = now;
        await scope.tx.getRepository(WorkflowTask).save(task);
        const instance = await scope.tx.getRepository(WorkflowInstance).findOne({ where: { id: task.instanceId, organizationId } });
        if (instance) {
          await this.record(scope, instance, 'escalated', {
            toNodeId: task.nodeId,
            detail: { taskId: task.id, nodeName: task.name, dueAt: task.dueAt?.toISOString() ?? null },
          });
          scope.effects.push(() => this.notifier.taskOverdue(task, instance));
        }
        return true;
      }, null).catch((error: unknown) => {
        this.logger.error(`No se pudo escalar la tarea ${candidate.id}: ${(error as Error)?.message ?? error}`);
        return false;
      });
      if (done) count += 1;
    }
    return count;
  }

  // ── Advancing ────────────────────────────────────────────────────────────────

  /**
   * Drive every active token until each is parked or done, then persist the instance.
   *
   * A thrown error inside a node does not escape: the instance is marked FAILED with the reason and
   * saved, so the failure is a recorded state (and `retry`-able) rather than a 500 that loses where
   * the process got to.
   */
  private async run(scope: RunScope, instance: WorkflowInstance, definition: WorkflowDefinition): Promise<WorkflowInstance> {
    const instances = scope.tx.getRepository(WorkflowInstance);
    const graph = definition.graph;
    let steps = 0;

    try {
      for (;;) {
        const token = instance.tokens.find((candidate) => candidate.state === 'active');
        if (!token) break;
        if ((steps += 1) > MAX_STEPS_PER_RUN) {
          throw new Error('step limit exceeded — the graph may contain a loop with no wait');
        }
        const node = nodeOf(graph, token.nodeId);
        if (!node) throw new Error(`node «${token.nodeId}» is not in the definition graph`);
        await this.step(scope, instance, graph, node, token);
      }

      this.recomputeWake(instance);
      this.maybeComplete(scope, instance, graph);
      if (instance.status === WorkflowInstanceStatus.COMPLETED) {
        await this.record(scope, instance, 'completed', {
          toNodeId: scope.endsReached[scope.endsReached.length - 1] ?? null,
          detail: { result: instance.result },
        });
      }
      return await instances.save(instance);
    } catch (error) {
      instance.status = WorkflowInstanceStatus.FAILED;
      instance.error = String((error as Error)?.message ?? error).slice(0, 2000);
      instance.nextWakeAt = null;
      await this.record(scope, instance, 'error', { detail: { message: instance.error } });
      scope.effects.push(() => this.notifier.instanceFailed(instance, definition));
      return instances.save(instance);
    }
  }

  private async step(scope: RunScope, instance: WorkflowInstance, graph: WorkflowGraph, node: WorkflowGraphNode, token: WorkflowToken): Promise<void> {
    switch (node.type) {
      case WorkflowNodeType.START:
        follow(token, pickEdge(graph, node, {}));
        return;

      case WorkflowNodeType.END:
        token.state = 'done';
        scope.endsReached.push(node.id);
        return;

      case WorkflowNodeType.ACTION: {
        const key = node.config?.action;
        const action = key ? this.actions.get(key) : undefined;
        if (!action) throw new Error(`action «${key ?? '(none)'}» is not registered`);
        const result = await action.run({
          organizationId: instance.organizationId,
          instanceId: instance.id,
          nodeId: node.id,
          context: instance.context,
          params: node.config?.actionParams ?? {},
          startedByUserId: instance.startedByUserId,
          subjectLabel: instance.subject?.label ?? null,
        });
        if (result.patch) instance.context = { ...instance.context, ...sanitizeContext(result.patch) };
        const edge = pickEdge(graph, node, { outcome: result.outcome });
        await this.record(scope, instance, 'action', {
          fromNodeId: node.id,
          toNodeId: edge?.to ?? null,
          detail: { action: key, nodeName: node.name ?? null, outcome: result.outcome ?? null, summary: result.summary?.slice(0, 500) ?? null },
        });
        follow(token, edge);
        return;
      }

      case WorkflowNodeType.CONDITION: {
        const edge = pickConditionEdge(graph, node, instance.context);
        if (!edge) throw new Error(`condition «${node.name ?? node.id}» has no matching branch and no default`);
        await this.record(scope, instance, 'condition', {
          fromNodeId: node.id,
          toNodeId: edge.to,
          detail: {
            edge: edge.id,
            nodeName: node.name ?? null,
            branch: edge.label ?? null,
            isDefault: !!edge.default,
            nextNodeName: nodeOf(graph, edge.to)?.name ?? null,
          },
        });
        follow(token, edge);
        return;
      }

      case WorkflowNodeType.TASK:
      case WorkflowNodeType.APPROVAL: {
        await this.createTask(scope, instance, node, token);
        token.state = 'waiting';
        token.waitKind = 'task';
        return;
      }

      case WorkflowNodeType.TIMER: {
        const wakeAt = computeWake(node, instance.context);
        token.state = 'waiting';
        token.waitKind = 'timer';
        token.wakeAt = wakeAt.toISOString();
        await this.record(scope, instance, 'timer_set', {
          fromNodeId: node.id,
          toNodeId: node.id,
          detail: { wakeAt: token.wakeAt, nodeName: node.name ?? null },
        });
        return;
      }

      default:
        throw new Error(`unknown node type «${(node as WorkflowGraphNode).type}»`);
    }
  }

  private async createTask(scope: RunScope, instance: WorkflowInstance, node: WorkflowGraphNode, token: WorkflowToken): Promise<void> {
    const config = node.config ?? {};
    const outcomes = effectiveOutcomes(node);
    const dueAt = config.dueInHours && config.dueInHours > 0 ? new Date(Date.now() + config.dueInHours * 3600_000) : null;
    const tasks = scope.tx.getRepository(WorkflowTask);

    const task = await tasks.save(
      tasks.create({
        organizationId: instance.organizationId,
        instanceId: instance.id,
        nodeId: node.id,
        tokenId: token.id,
        name: (node.name?.trim() || node.id).slice(0, 200),
        nodeType: node.type,
        assigneeRoleId: config.assigneeRoleId || null,
        assigneeUserId: config.assigneeUserId || null,
        escalateToUserId: config.escalateToUserId || null,
        outcomes,
        outcomeLabels: config.outcomeLabels ?? null,
        commentRequiredFor: config.commentRequiredFor?.length
          ? config.commentRequiredFor
          : node.type === WorkflowNodeType.APPROVAL
            ? ['reject']
            : null,
        form: config.form?.length ? config.form : null,
        instructions: config.instructions?.trim() || null,
        status: WorkflowTaskStatus.OPEN,
        outcome: null,
        dueAt,
        completedByUserId: null,
        completedAt: null,
        formData: null,
        comment: null,
        escalatedAt: null,
      }),
    );

    await this.record(scope, instance, 'task_created', {
      toNodeId: node.id,
      detail: { taskId: task.id, nodeName: task.name, outcomes, dueAt: dueAt?.toISOString() ?? null },
    });
    scope.effects.push(() => this.notifier.taskCreated(task, instance));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /** One transaction, with the effects it queued run only after it commits. */
  private async transaction<T>(work: (scope: RunScope) => Promise<T>, actorUserId: string | null): Promise<T> {
    const effects: Effect[] = [];
    const result = await this.dataSource.transaction((tx) => work({ tx, effects, actorUserId, endsReached: [] }));
    for (const effect of effects) {
      await Promise.resolve()
        .then(effect)
        .catch((error: unknown) =>
        this.logger.warn(`Efecto posterior no aplicado: ${(error as Error)?.message ?? error}`),
      );
    }
    return result;
  }

  private async lockInstance(tx: EntityManager, id: string, organizationId: string): Promise<WorkflowInstance> {
    const instance = await tx.getRepository(WorkflowInstance).findOne({
      where: { id, organizationId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!instance) throw new NotFoundError('workflow_engine.instance_not_found');
    return instance;
  }

  private recomputeWake(instance: WorkflowInstance): void {
    const times = instance.tokens
      .filter((token) => token.state === 'waiting' && token.waitKind === 'timer' && token.wakeAt)
      .map((token) => new Date(token.wakeAt as string).getTime())
      .filter((time) => !Number.isNaN(time));
    instance.nextWakeAt = times.length ? new Date(Math.min(...times)) : null;
  }

  private maybeComplete(scope: RunScope, instance: WorkflowInstance, graph: WorkflowGraph): void {
    if (instance.status !== WorkflowInstanceStatus.RUNNING) return;
    if (instance.tokens.some((token) => token.state !== 'done')) return;
    instance.status = WorkflowInstanceStatus.COMPLETED;
    instance.completedAt = new Date();
    const lastEnd = scope.endsReached[scope.endsReached.length - 1];
    const endNode = lastEnd ? nodeOf(graph, lastEnd) : undefined;
    instance.result = endNode ? (endNode.name?.trim() || null) : null;
  }

  private async loadDefinition(tx: EntityManager, instance: WorkflowInstance): Promise<WorkflowDefinition> {
    const definition = await tx.getRepository(WorkflowDefinition).findOne({
      where: { id: instance.definitionId, organizationId: instance.organizationId },
    });
    if (!definition) throw new NotFoundError('workflow_engine.definition_not_found');
    return definition;
  }

  private async record(
    scope: RunScope,
    instance: WorkflowInstance,
    kind: WorkflowTransitionKind,
    detail: { fromNodeId?: string | null; toNodeId?: string | null; actorUserId?: string | null; detail?: Record<string, unknown> } = {},
  ): Promise<void> {
    const transitions = scope.tx.getRepository(WorkflowTransition);
    await transitions.save(
      transitions.create({
        organizationId: instance.organizationId,
        instanceId: instance.id,
        fromNodeId: detail.fromNodeId ?? null,
        toNodeId: detail.toNodeId ?? null,
        kind,
        detail: detail.detail ?? null,
        actorUserId: detail.actorUserId ?? null,
      }),
    );
  }

  /** Tasks that are open for these instances, for callers that render them. */
  async openTasksFor(instanceIds: string[], organizationId: string): Promise<WorkflowTask[]> {
    if (instanceIds.length === 0) return [];
    return this.dataSource.getRepository(WorkflowTask).find({
      where: { organizationId, instanceId: In(instanceIds), status: WorkflowTaskStatus.OPEN },
    });
  }
}

// ── Pure helpers (exported for tests) ───────────────────────────────────────────

export function nodeOf(graph: WorkflowGraph, id: string): WorkflowGraphNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

function edgesFrom(graph: WorkflowGraph, nodeId: string): WorkflowGraphEdge[] {
  return graph.edges.filter((edge) => edge.from === nodeId);
}

/**
 * The edge to take out of a node.
 *
 * With an outcome (a task result, or an action that returned one), the edge labelled with that
 * outcome wins; otherwise the one marked `default`; otherwise the only unlabelled one. This is what
 * lets a task's «approve» and «reject» lead to different places, and an ordinary step have exactly
 * one next.
 */
export function pickEdge(graph: WorkflowGraph, node: WorkflowGraphNode, options: { outcome?: string }): WorkflowGraphEdge | undefined {
  const edges = edgesFrom(graph, node.id);
  if (options.outcome) {
    const byOutcome = edges.find((edge) => edge.outcome === options.outcome);
    if (byOutcome) return byOutcome;
  }
  return edges.find((edge) => edge.default) ?? edges.find((edge) => !edge.outcome && !edge.condition) ?? (edges.length === 1 ? edges[0] : undefined);
}

/** The first branch whose predicate holds, else the default branch. Order is the author's order. */
export function pickConditionEdge(graph: WorkflowGraph, node: WorkflowGraphNode, context: Record<string, unknown>): WorkflowGraphEdge | undefined {
  const edges = edgesFrom(graph, node.id);
  for (const edge of edges) {
    if (!edge.default && edge.condition && evaluatePredicate(edge.condition, context)) return edge;
  }
  return edges.find((edge) => edge.default);
}

/** Move a token along an edge, or end it when the node is a dead end. */
export function follow(token: WorkflowToken, edge: WorkflowGraphEdge | undefined): void {
  delete token.waitKind;
  delete token.wakeAt;
  if (edge) {
    token.nodeId = edge.to;
    token.state = 'active';
  } else {
    token.state = 'done';
  }
}

export function computeWake(node: WorkflowGraphNode, context: Record<string, unknown>, now = Date.now()): Date {
  const untilVar = node.config?.timerUntilVar;
  if (untilVar) {
    const raw = untilVar.split('.').reduce<unknown>(
      (value, segment) =>
        value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, segment)
          ? (value as Record<string, unknown>)[segment]
          : undefined,
      context,
    );
    const parsed = raw ? new Date(String(raw)) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  }
  const minutes = Number(node.config?.timerMinutes ?? 60);
  return new Date(now + (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000);
}

/**
 * Whoever completes a task must be its assignee or hold its role. An unassigned task (only possible
 * for drafts published before assignment was required) is open to anyone the permission let in.
 */
export function assertCanAct(task: WorkflowTask, actor: TaskActor): void {
  if (task.assigneeUserId) {
    if (task.assigneeUserId !== actor.userId) throw new ForbiddenError('workflow_engine.not_your_task');
    return;
  }
  if (task.assigneeRoleId && !actor.roleIds.includes(task.assigneeRoleId)) {
    throw new ForbiddenError('workflow_engine.not_your_task');
  }
}

function sanitizeSubject(subject: WorkflowSubject | null | undefined): WorkflowSubject | null {
  if (!subject || typeof subject !== 'object') return null;
  const clip = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);
  const route = clip(subject.route, 300);
  const clean: WorkflowSubject = {
    type: clip(subject.type, 60),
    id: clip(subject.id, 120),
    label: clip(subject.label, 200),
    // Only an in-app path: a subject route is rendered as a link in the inbox.
    route: route && route.startsWith('/') && !route.startsWith('//') ? route : undefined,
  };
  return clean.type || clean.id || clean.label ? clean : null;
}
