import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LanguageCode } from '@virteex/shared/types';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { NotificationsService } from '../notifications/notifications.service';
import {
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowNodeType,
  WorkflowToken,
} from './contracts/workflow-graph';
import { evaluatePredicate } from './contracts/workflow-predicate';
import {
  WorkflowDefinition,
} from './entities/workflow-definition.entity';
import { WorkflowInstance, WorkflowInstanceStatus } from './entities/workflow-instance.entity';
import { WorkflowTask, WorkflowTaskStatus } from './entities/workflow-task.entity';
import { WorkflowTransition, WorkflowTransitionKind } from './entities/workflow-transition.entity';
import { WorkflowActionRegistry } from './workflow-action.registry';

/** The guard against a mis-authored loop: no instance advances more than this many steps in one run. */
const MAX_STEPS_PER_RUN = 1000;

export interface StartOptions {
  context?: Record<string, unknown>;
  subject?: { type?: string; id?: string; label?: string };
  startedByUserId?: string | null;
}

export interface CompleteTaskOptions {
  outcome: string;
  formData?: Record<string, unknown>;
  actorUserId: string;
}

/**
 * The execution engine for business workflows.
 *
 * It advances an instance by moving its tokens through the definition's graph: automatic nodes run
 * and move on in the same breath, a condition picks the first branch whose predicate holds, and a
 * human node parks its token on a {@link WorkflowTask} until someone completes it. Every query is
 * scoped to the tenant explicitly and runs under the row-level policies — in a request through the
 * interceptor's context, in the timer sweep through `runAsTenantJob` — so an instance never sees,
 * resumes or completes across a company boundary.
 *
 * Correctness rests on three rules: a token only ever moves forward along a declared edge; a run
 * stops when every token is parked or done; and an unrunnable node (a missing action, a dead end, a
 * step explosion) fails the instance loudly with the reason, rather than looping or silently
 * stalling.
 */
@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    @InjectRepository(WorkflowDefinition)
    private readonly definitions: Repository<WorkflowDefinition>,
    @InjectRepository(WorkflowInstance)
    private readonly instances: Repository<WorkflowInstance>,
    @InjectRepository(WorkflowTask)
    private readonly tasks: Repository<WorkflowTask>,
    @InjectRepository(WorkflowTransition)
    private readonly transitions: Repository<WorkflowTransition>,
    private readonly actions: WorkflowActionRegistry,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // ── Starting ───────────────────────────────────────────────────────────────

  async start(
    definition: WorkflowDefinition,
    options: StartOptions,
    organizationId: string,
  ): Promise<WorkflowInstance> {
    const startNode = definition.graph.nodes.find((node) => node.type === WorkflowNodeType.START);
    if (!startNode) throw new BadRequestError('workflow_engine.no_start_node');

    const token: WorkflowToken = { id: uuidv4(), nodeId: startNode.id, state: 'active' };
    const created = await this.instances.save(
      this.instances.create({
        organizationId,
        definitionId: definition.id,
        definitionVersion: definition.version,
        status: WorkflowInstanceStatus.RUNNING,
        context: options.context ?? {},
        tokens: [token],
        subject: options.subject ?? null,
        startedByUserId: options.startedByUserId ?? null,
        nextWakeAt: null,
        error: null,
        completedAt: null,
      }),
    );

    await this.record(created, 'started', {
      toNodeId: startNode.id,
      actorUserId: options.startedByUserId ?? null,
    });
    return this.run(created, definition, options.startedByUserId ?? null);
  }

  // ── Advancing ────────────────────────────────────────────────────────────────

  /**
   * Drive every active token until each is parked or done, then persist the instance.
   *
   * A thrown error inside a node (a missing action, an action that failed) does not escape: the
   * instance is marked FAILED with the reason and saved, so the failure is a recorded state rather
   * than a 500 that loses where the process got to.
   */
  async run(
    instance: WorkflowInstance,
    definition: WorkflowDefinition,
    actorUserId: string | null,
  ): Promise<WorkflowInstance> {
    const graph = definition.graph;
    let steps = 0;

    try {
      for (;;) {
        const token = instance.tokens.find((candidate) => candidate.state === 'active');
        if (!token) break;
        if ((steps += 1) > MAX_STEPS_PER_RUN) {
          throw new Error('step limit exceeded — the graph may contain a loop with no wait');
        }

        const node = this.nodeOf(graph, token.nodeId);
        if (!node) throw new Error(`node «${token.nodeId}» is not in the definition graph`);

        await this.step(instance, graph, node, token, actorUserId);
      }

      this.recomputeWake(instance);
      this.maybeComplete(instance);
      return await this.instances.save(instance);
    } catch (error) {
      instance.status = WorkflowInstanceStatus.FAILED;
      instance.error = (error as Error).message;
      instance.nextWakeAt = null;
      await this.record(instance, 'error', { detail: { message: instance.error } });
      return this.instances.save(instance);
    }
  }

  private async step(
    instance: WorkflowInstance,
    graph: WorkflowGraph,
    node: WorkflowGraphNode,
    token: WorkflowToken,
    actorUserId: string | null,
  ): Promise<void> {
    switch (node.type) {
      case WorkflowNodeType.START:
        this.follow(token, this.pickEdge(graph, node, {}));
        return;

      case WorkflowNodeType.END:
        token.state = 'done';
        return;

      case WorkflowNodeType.ACTION: {
        const result = await this.runAction(instance, node);
        if (result.patch) instance.context = { ...instance.context, ...result.patch };
        await this.record(instance, 'action', {
          fromNodeId: node.id,
          detail: { action: node.config?.action, outcome: result.outcome ?? null },
        });
        this.follow(token, this.pickEdge(graph, node, { outcome: result.outcome }));
        return;
      }

      case WorkflowNodeType.CONDITION: {
        const edge = this.pickConditionEdge(graph, node, instance.context);
        if (!edge) throw new Error(`condition «${node.id}» has no matching branch and no default`);
        await this.record(instance, 'condition', {
          fromNodeId: node.id,
          toNodeId: edge.to,
          detail: { edge: edge.id },
        });
        this.follow(token, edge);
        return;
      }

      case WorkflowNodeType.TASK:
      case WorkflowNodeType.APPROVAL: {
        await this.createTask(instance, node, token);
        token.state = 'waiting';
        token.waitKind = 'task';
        return;
      }

      case WorkflowNodeType.TIMER: {
        const wakeAt = this.computeWake(node, instance.context);
        token.state = 'waiting';
        token.waitKind = 'timer';
        token.wakeAt = wakeAt.toISOString();
        await this.record(instance, 'timer_set', { fromNodeId: node.id, detail: { wakeAt: token.wakeAt } });
        return;
      }

      default:
        throw new Error(`unknown node type «${(node as WorkflowGraphNode).type}»`);
    }
  }

  // ── Completing a human task ───────────────────────────────────────────────────

  async completeTask(task: WorkflowTask, options: CompleteTaskOptions): Promise<WorkflowInstance> {
    if (task.status !== WorkflowTaskStatus.OPEN) {
      throw new BadRequestError('workflow_engine.task_not_open');
    }
    if (task.outcomes.length > 0 && !task.outcomes.includes(options.outcome)) {
      throw new BadRequestError('workflow_engine.invalid_outcome', { outcome: options.outcome });
    }

    const instance = await this.instances.findOne({
      where: { id: task.instanceId, organizationId: task.organizationId },
    });
    if (!instance) throw new NotFoundError('workflow_engine.instance_not_found');
    if (instance.status !== WorkflowInstanceStatus.RUNNING) {
      throw new BadRequestError('workflow_engine.instance_not_running');
    }
    const definition = await this.loadDefinition(instance);

    task.status = WorkflowTaskStatus.COMPLETED;
    task.outcome = options.outcome;
    task.completedByUserId = options.actorUserId;
    task.completedAt = new Date();
    task.formData = options.formData ?? null;
    await this.tasks.save(task);

    // The outcome and whatever the actor filled in become context the rest of the flow can read.
    instance.context = {
      ...instance.context,
      ...(options.formData ?? {}),
      [task.nodeId]: { outcome: options.outcome, ...(options.formData ?? {}) },
      lastOutcome: options.outcome,
    };

    const token = instance.tokens.find((candidate) => candidate.id === task.tokenId);
    const node = this.nodeOf(definition.graph, task.nodeId);
    const edge = node ? this.pickEdge(definition.graph, node, { outcome: options.outcome }) : undefined;
    await this.record(instance, 'task_completed', {
      fromNodeId: task.nodeId,
      toNodeId: edge?.to ?? null,
      actorUserId: options.actorUserId,
      detail: { outcome: options.outcome },
    });
    if (token) this.follow(token, edge);

    return this.run(instance, definition, options.actorUserId);
  }

  // ── Cancelling ────────────────────────────────────────────────────────────────

  async cancel(instance: WorkflowInstance, actorUserId: string): Promise<WorkflowInstance> {
    if (instance.status !== WorkflowInstanceStatus.RUNNING) {
      throw new BadRequestError('workflow_engine.instance_not_running');
    }
    instance.status = WorkflowInstanceStatus.CANCELLED;
    instance.completedAt = new Date();
    instance.nextWakeAt = null;
    instance.tokens = instance.tokens.map((token) => ({ ...token, state: 'done' as const }));
    await this.instances.save(instance);
    await this.tasks.update(
      { instanceId: instance.id, organizationId: instance.organizationId, status: WorkflowTaskStatus.OPEN },
      { status: WorkflowTaskStatus.CANCELLED },
    );
    await this.record(instance, 'cancelled', { actorUserId });
    return instance;
  }

  // ── Timer resume (called per-tenant by the sweep) ─────────────────────────────

  /** Resume every running instance whose earliest parked timer is due. Returns how many advanced. */
  async resumeDueTimers(organizationId: string, now: Date = new Date()): Promise<number> {
    const due = await this.instances.find({
      where: {
        organizationId,
        status: WorkflowInstanceStatus.RUNNING,
        nextWakeAt: LessThanOrEqual(now),
      },
    });

    let resumed = 0;
    for (const instance of due) {
      const definition = await this.loadDefinition(instance).catch(() => null);
      if (!definition) continue;

      let woke = false;
      for (const token of instance.tokens) {
        if (
          token.state === 'waiting' &&
          token.waitKind === 'timer' &&
          token.wakeAt &&
          new Date(token.wakeAt) <= now
        ) {
          token.state = 'active';
          delete token.waitKind;
          delete token.wakeAt;
          woke = true;
          await this.record(instance, 'timer_fired', { toNodeId: token.nodeId });
        }
      }
      if (woke) {
        await this.run(instance, definition, null);
        resumed += 1;
      }
    }
    return resumed;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private nodeOf(graph: WorkflowGraph, id: string): WorkflowGraphNode | undefined {
    return graph.nodes.find((node) => node.id === id);
  }

  private edgesFrom(graph: WorkflowGraph, nodeId: string): WorkflowGraphEdge[] {
    return graph.edges.filter((edge) => edge.from === nodeId);
  }

  /**
   * The edge to take out of a node.
   *
   * With an outcome (a task result, or an action that returned one), the edge labelled with that
   * outcome wins; otherwise the one marked `default`; otherwise the first. This is what lets a task's
   * «approve» and «reject» lead to different places, and an ordinary step have exactly one next.
   */
  private pickEdge(
    graph: WorkflowGraph,
    node: WorkflowGraphNode,
    options: { outcome?: string },
  ): WorkflowGraphEdge | undefined {
    const edges = this.edgesFrom(graph, node.id);
    if (options.outcome) {
      const byOutcome = edges.find((edge) => edge.outcome === options.outcome);
      if (byOutcome) return byOutcome;
    }
    return edges.find((edge) => edge.default) ?? edges[0];
  }

  /** The first branch whose predicate holds, else the default branch. Order is the author's order. */
  private pickConditionEdge(
    graph: WorkflowGraph,
    node: WorkflowGraphNode,
    context: Record<string, unknown>,
  ): WorkflowGraphEdge | undefined {
    const edges = this.edgesFrom(graph, node.id);
    for (const edge of edges) {
      if (edge.condition && evaluatePredicate(edge.condition, context)) return edge;
    }
    return edges.find((edge) => edge.default);
  }

  /** Move a token along an edge, or end it when the node is a dead end. */
  private follow(token: WorkflowToken, edge: WorkflowGraphEdge | undefined): void {
    if (edge) {
      token.nodeId = edge.to;
      token.state = 'active';
      delete token.waitKind;
      delete token.wakeAt;
    } else {
      token.state = 'done';
    }
  }

  private async runAction(
    instance: WorkflowInstance,
    node: WorkflowGraphNode,
  ): Promise<{ outcome?: string; patch?: Record<string, unknown> }> {
    const key = node.config?.action;
    const action = key ? this.actions.get(key) : undefined;
    if (!action) throw new Error(`action «${key ?? '(none)'}» is not registered`);
    return action.run({
      organizationId: instance.organizationId,
      instanceId: instance.id,
      nodeId: node.id,
      context: instance.context,
      params: node.config?.actionParams ?? {},
      startedByUserId: instance.startedByUserId,
    });
  }

  private async createTask(
    instance: WorkflowInstance,
    node: WorkflowGraphNode,
    token: WorkflowToken,
  ): Promise<void> {
    const outcomes =
      node.config?.outcomes && node.config.outcomes.length > 0
        ? node.config.outcomes
        : node.type === WorkflowNodeType.APPROVAL
          ? ['approve', 'reject']
          : ['done'];
    const dueAt = node.config?.dueInHours
      ? new Date(Date.now() + node.config.dueInHours * 3600_000)
      : null;

    const task = await this.tasks.save(
      this.tasks.create({
        organizationId: instance.organizationId,
        instanceId: instance.id,
        nodeId: node.id,
        tokenId: token.id,
        name: node.name ?? node.id,
        assigneeRoleId: node.config?.assigneeRoleId ?? null,
        assigneeUserId: node.config?.assigneeUserId ?? null,
        outcomes,
        status: WorkflowTaskStatus.OPEN,
        outcome: null,
        dueAt,
        completedByUserId: null,
        completedAt: null,
        formData: null,
      }),
    );

    await this.record(instance, 'task_created', {
      toNodeId: node.id,
      detail: { taskId: task.id, outcomes },
    });

    // Best-effort: tell a named assignee it is waiting. A role-only task shows up in the inbox.
    if (task.assigneeUserId && this.notifications) {
      await this.notifications
        .createLocalizedNotification(task.assigneeUserId, 'es' as LanguageCode, {
          titleKey: 'workflow_engine.notify.task_title',
          bodyKey: 'workflow_engine.notify.task_body',
          params: { task: task.name },
          link: '/workflow-tasks',
          organizationId: instance.organizationId,
        })
        .catch((error: unknown) =>
          this.logger.warn(`aviso de tarea no enviado: ${(error as Error)?.message ?? error}`),
        );
    }
  }

  private computeWake(node: WorkflowGraphNode, context: Record<string, unknown>): Date {
    const untilVar = node.config?.timerUntilVar;
    if (untilVar) {
      const raw = untilVar.split('.').reduce<unknown>(
        (value, segment) =>
          value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined,
        context,
      );
      const parsed = raw ? new Date(String(raw)) : null;
      if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
    }
    const minutes = Number(node.config?.timerMinutes ?? 60);
    return new Date(Date.now() + (Number.isFinite(minutes) ? minutes : 60) * 60_000);
  }

  private recomputeWake(instance: WorkflowInstance): void {
    const times = instance.tokens
      .filter((token) => token.state === 'waiting' && token.waitKind === 'timer' && token.wakeAt)
      .map((token) => new Date(token.wakeAt as string).getTime())
      .filter((time) => !Number.isNaN(time));
    instance.nextWakeAt = times.length ? new Date(Math.min(...times)) : null;
  }

  private maybeComplete(instance: WorkflowInstance): void {
    if (instance.status !== WorkflowInstanceStatus.RUNNING) return;
    const pending = instance.tokens.some((token) => token.state !== 'done');
    if (!pending) {
      instance.status = WorkflowInstanceStatus.COMPLETED;
      instance.completedAt = new Date();
    }
  }

  private async loadDefinition(instance: WorkflowInstance): Promise<WorkflowDefinition> {
    const definition = await this.definitions.findOne({
      where: { id: instance.definitionId, organizationId: instance.organizationId },
    });
    if (!definition) throw new NotFoundError('workflow_engine.definition_not_found');
    return definition;
  }

  private async record(
    instance: WorkflowInstance,
    kind: WorkflowTransitionKind,
    detail: {
      fromNodeId?: string | null;
      toNodeId?: string | null;
      actorUserId?: string | null;
      detail?: Record<string, unknown>;
    } = {},
  ): Promise<void> {
    await this.transitions.save(
      this.transitions.create({
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
}
