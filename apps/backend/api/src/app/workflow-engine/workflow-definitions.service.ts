import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../i18n/localized.exception';
import { WorkflowDefinition, WorkflowDefinitionStatus } from './entities/workflow-definition.entity';
import { WorkflowInstance, WorkflowInstanceStatus } from './entities/workflow-instance.entity';
import { WorkflowGraph, WorkflowNodeType, WorkflowTrigger } from './contracts/workflow-graph';
import { WorkflowActionRegistry } from './workflow-action.registry';
import { WorkflowDirectoryService } from './workflow-directory.service';
import { eventDefinition, isKnownWorkflowEvent } from './events/workflow-event.catalogue';
import { PERMISSIONS } from '../shared/permissions';
import { DOCUMENT_DECISION_ACTION, DOCUMENT_DECISION_SOURCES } from './actions/document-actions';
import { isDevLikeEnvironment } from '../config/environment';
import { WorkflowIssue, semanticIssues, structuralIssues } from './validation/workflow-graph.validator';
import {
  CreateWorkflowDefinitionDto,
  ListDefinitionsQueryDto,
  PublishDefinitionDto,
  UpdateWorkflowDefinitionDto,
} from './dto/workflow.dto';

const MANUAL_TRIGGER: WorkflowTrigger = { mode: 'manual' };

/** A starter graph: a start wired to an end, so a new process is valid to look at from the first second. */
function starterGraph(): WorkflowGraph {
  return {
    nodes: [
      { id: 'start', type: WorkflowNodeType.START, position: { x: 80, y: 200 } },
      { id: 'end', type: WorkflowNodeType.END, position: { x: 480, y: 200 } },
    ],
    edges: [{ id: 'start-end', from: 'start', to: 'end' }],
    groups: [],
    variables: [],
    settings: { connectionType: 'bezier', layoutDirection: 'LR' },
  };
}

/** A summary row for the catalogue: one per process key, with its versions. */
export interface WorkflowDefinitionSummary {
  key: string;
  name: string;
  description: string | null;
  trigger: WorkflowTrigger;
  /** The live version, if any. */
  published: WorkflowDefinition | null;
  /** The open draft, if any (at most one per key). */
  draft: WorkflowDefinition | null;
  /** Every version, newest first, without graphs. */
  versions: Array<Pick<WorkflowDefinition, 'id' | 'version' | 'status' | 'updatedAt' | 'publishedAt' | 'publishedByUserId'>>;
  updatedAt: Date;
  runningCount: number;
}

/**
 * The design side: creating, versioning, validating and publishing workflow definitions.
 *
 * A design is editable only while DRAFT; publishing freezes it and makes it the one PUBLISHED
 * version of its `key`, archiving the version it replaces so that instances already running on the
 * old one still resolve it. Revising a published process is `createVersion`, which opens the key's
 * one draft (creating it from the live version if there is none) — the design never mutates under a
 * running instance, and two people can never end up editing two different drafts of one process.
 *
 * Publishing an older version over a newer one is refused unless the caller says, explicitly, that
 * it is a rollback; restoring an archived version goes through the same door.
 */
@Injectable()
export class WorkflowDefinitionsService {
  constructor(
    @InjectRepository(WorkflowDefinition)
    private readonly definitions: Repository<WorkflowDefinition>,
    @InjectRepository(WorkflowInstance)
    private readonly instances: Repository<WorkflowInstance>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly actions: WorkflowActionRegistry,
    private readonly directory: WorkflowDirectoryService,
  ) {}

  // ── Reading ───────────────────────────────────────────────────────────────

  async list(organizationId: string, query: ListDefinitionsQueryDto = {}): Promise<WorkflowDefinition[]> {
    const qb = this.definitions
      .createQueryBuilder('d')
      .where('d.organization_id = :organizationId', { organizationId })
      .orderBy('d.updated_at', 'DESC');
    if (query.status) qb.andWhere('d.status = :status', { status: query.status });
    if (query.key) qb.andWhere('d.key = :key', { key: query.key });
    if (query.search?.trim()) {
      qb.andWhere('(lower(d.name) LIKE :term OR lower(d.key) LIKE :term)', { term: `%${escapeLike(query.search.trim().toLowerCase())}%` });
    }
    return qb.getMany();
  }

  /**
   * The process catalogue: one entry per key, with its live version, its open draft and its history.
   *
   * This is what the list shows. Grouping here rather than in the client means a process with forty
   * versions is one row, and the «which version is live» question is answered by the server.
   */
  async catalogue(organizationId: string, search?: string): Promise<WorkflowDefinitionSummary[]> {
    const all = await this.list(organizationId, { search });
    const running: Array<{ definition_id: string; count: string }> = await this.dataSource.query(
      `SELECT definition_id, count(*) AS count FROM workflow_instances
        WHERE organization_id = $1 AND status = 'RUNNING' GROUP BY definition_id`,
      [organizationId],
    );
    const runningBy = new Map(running.map((row) => [row.definition_id, Number(row.count)]));

    const byKey = new Map<string, WorkflowDefinition[]>();
    for (const definition of all) byKey.set(definition.key, [...(byKey.get(definition.key) ?? []), definition]);

    const summaries: WorkflowDefinitionSummary[] = [];
    for (const [key, versions] of byKey) {
      versions.sort((a, b) => b.version - a.version);
      const published = versions.find((v) => v.status === WorkflowDefinitionStatus.PUBLISHED) ?? null;
      const draft = versions.find((v) => v.status === WorkflowDefinitionStatus.DRAFT) ?? null;
      const head = draft ?? published ?? versions[0];
      summaries.push({
        key,
        name: head.name,
        description: head.description,
        trigger: (published ?? head).trigger,
        published,
        draft,
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          status: v.status,
          updatedAt: v.updatedAt,
          publishedAt: v.publishedAt,
          publishedByUserId: v.publishedByUserId,
        })),
        updatedAt: versions.reduce((latest, v) => (v.updatedAt > latest ? v.updatedAt : latest), head.updatedAt),
        runningCount: versions.reduce((sum, v) => sum + (runningBy.get(v.id) ?? 0), 0),
      });
    }
    return summaries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async get(id: string, organizationId: string): Promise<WorkflowDefinition> {
    const definition = await this.definitions.findOne({ where: { id, organizationId } });
    if (!definition) throw new NotFoundError('workflow_engine.definition_not_found');
    return definition;
  }

  async getPublishedByKey(key: string, organizationId: string): Promise<WorkflowDefinition | null> {
    return this.definitions.findOne({ where: { organizationId, key, status: WorkflowDefinitionStatus.PUBLISHED } });
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  async create(dto: CreateWorkflowDefinitionDto, organizationId: string, actorUserId: string): Promise<WorkflowDefinition> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestError('workflow_engine.name_required');
    await this.assertNameFree(name, organizationId, null);
    const graph = dto.graph ? (dto.graph as WorkflowGraph) : starterGraph();
    const trigger = (dto.trigger as WorkflowTrigger) ?? MANUAL_TRIGGER;
    this.assertStructure(graph, trigger);

    const key = await this.freshKey(dto.key || name, organizationId);
    return this.definitions.save(
      this.definitions.create({
        organizationId,
        key,
        name,
        description: dto.description?.trim() || null,
        version: 1,
        status: WorkflowDefinitionStatus.DRAFT,
        graph,
        trigger,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        publishedAt: null,
        publishedByUserId: null,
      }),
    );
  }

  /** Copy a process (any version) into a brand-new process with its own key. */
  async duplicate(id: string, name: string | undefined, organizationId: string, actorUserId: string): Promise<WorkflowDefinition> {
    const source = await this.get(id, organizationId);
    // A name the person typed is theirs: if it is taken they are told, never handed another one.
    // Only the suggested «copy of …» name is numbered to find a free one.
    if (name?.trim()) await this.assertNameFree(name.trim(), organizationId, null);
    const base = (name?.trim() || `${source.name} (copia)`).slice(0, 200);
    let candidate = base;
    for (let suffix = 2; await this.nameTaken(candidate, organizationId, null); suffix += 1) {
      candidate = `${base.slice(0, 190)} ${suffix}`;
    }
    return this.create(
      { name: candidate, description: source.description ?? undefined, graph: source.graph, trigger: source.trigger },
      organizationId,
      actorUserId,
    );
  }

  async update(id: string, dto: UpdateWorkflowDefinitionDto, organizationId: string, actorUserId: string): Promise<WorkflowDefinition> {
    const definition = await this.get(id, organizationId);
    if (definition.status !== WorkflowDefinitionStatus.DRAFT) {
      throw new ConflictError('workflow_engine.only_draft_editable');
    }
    // Optimistic concurrency: a designer saving over a version someone else saved after they loaded
    // it would silently lose that person's work.
    if (dto.expectedUpdatedAt && new Date(dto.expectedUpdatedAt).getTime() !== definition.updatedAt.getTime()) {
      throw new ConflictError('workflow_engine.edited_elsewhere');
    }
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestError('workflow_engine.name_required');
      if (name !== definition.name) await this.assertNameFree(name, organizationId, definition.key);
      // A process has one name across its versions.
      if (name !== definition.name) {
        await this.definitions.update({ organizationId, key: definition.key, id: Not(definition.id) }, { name });
      }
      definition.name = name;
    }
    if (dto.description !== undefined) definition.description = dto.description?.trim() || null;
    const graph = dto.graph !== undefined ? (dto.graph as WorkflowGraph) : definition.graph;
    const trigger = dto.trigger !== undefined ? (dto.trigger as WorkflowTrigger) : definition.trigger;
    this.assertStructure(graph, trigger);
    definition.graph = graph;
    definition.trigger = trigger;
    definition.updatedByUserId = actorUserId;
    return this.definitions.save(definition);
  }

  /**
   * Every problem the design has, errors and warnings, without changing anything.
   *
   * The designer calls this while the author works, to mark nodes on the canvas; publishing calls it
   * and refuses on any error.
   */
  async validate(
    graph: WorkflowGraph,
    trigger: WorkflowTrigger,
    organizationId: string,
    self: { key?: string; id?: string } = {},
  ): Promise<WorkflowIssue[]> {
    const structural = structuralIssues(graph, trigger);
    if (structural.some((issue) => FATAL_CODES.has(issue.code))) return structural;
    const userIds = new Set<string>();
    for (const node of graph.nodes) {
      if (node.config?.assigneeUserId) userIds.add(node.config.assigneeUserId);
      if (node.config?.escalateToUserId) userIds.add(node.config.escalateToUserId);
      const params = node.config?.action ? this.actions.paramsOf(node.config.action) : undefined;
      for (const param of params ?? []) {
        const value = node.config?.actionParams?.[param.name];
        if (param.type === 'user' && typeof value === 'string' && value) userIds.add(value);
      }
    }
    const [knownUsers, knownRoles, actingRoles, actingUsers, memberCounts] = await Promise.all([
      this.directory.userIdSet(organizationId, userIds),
      this.directory.roleIdSet(organizationId),
      this.directory.rolesWithPermission(organizationId, PERMISSIONS.WORKFLOW_TASK_ACT),
      this.directory.userIdsWithPermission(organizationId, PERMISSIONS.WORKFLOW_TASK_ACT),
      this.directory.roleMemberCounts(organizationId),
    ]);
    const issues = semanticIssues(graph, trigger, {
      actionParams: (key) => this.actions.paramsOf(key),
      actionOutcomes: (key) => this.actions.get(key)?.outcomes,
      actionWrites: (key, params) => this.actions.writesOf(key, params),
      isKnownEvent: isKnownWorkflowEvent,
      eventFields: (event) => eventDefinition(event)?.fields.map((field) => field.name),
      userIds: knownUsers,
      roleIds: knownRoles,
      actingRoleIds: new Set(actingRoles.keys()),
      actingUserIds: new Set(actingUsers),
      roleMemberCounts: memberCounts,
      allowHttpWebhooks: isDevLikeEnvironment(),
    });

    // `start_workflow` names another process by key: it must exist, be live, and never lead back
    // here. A ring of processes starting each other is caught at depth 5 by the engine — after
    // five useless runs; refusing it at design time is the only place it costs nothing.
    const published = await this.definitions.find({ where: { organizationId, status: WorkflowDefinitionStatus.PUBLISHED } });
    const startsOf = new Map<string, string[]>(published.map((d) => [d.key, subprocessKeys(d.graph)]));
    if (self.key) startsOf.set(self.key, subprocessKeys(graph));
    for (const node of graph.nodes) {
      if (node.config?.action !== 'start_workflow') continue;
      const key = String(node.config.actionParams?.['workflowKey'] ?? '');
      if (!key) continue;
      const exists = key === self.key || startsOf.has(key);
      if (!exists) {
        issues.push({ code: 'subprocess_unknown', severity: 'error', nodeId: node.id, params: { key } });
        continue;
      }
      if (self.key && reaches(key, self.key, startsOf)) {
        issues.push({ code: 'subprocess_cycle', severity: 'error', nodeId: node.id, params: { key } });
      }
    }

    // «Decide the document» acts on what the run is about; a run started by hand, or by an event
    // with no decidable document, has nothing to decide on and would always take its error exit.
    const documentNodes = graph.nodes.filter((node) => node.config?.action === DOCUMENT_DECISION_ACTION);
    if (documentNodes.length) {
      const subjectType = trigger.mode === 'event' && trigger.event ? eventDefinition(trigger.event)?.subjectType : undefined;
      if (!subjectType || !DOCUMENT_DECISION_SOURCES[subjectType]) {
        for (const node of documentNodes) issues.push({ code: 'document_action_without_document', severity: 'warning', nodeId: node.id });
      }
    }

    // Two live processes on one event both start on every occurrence: duplicate approvals for the
    // same people. Legitimate sometimes (a notification flow beside an approval flow), so a warning
    // the publisher must acknowledge, naming the others.
    if (trigger.mode === 'event' && trigger.event) {
      const others = published.filter(
        (d) => d.key !== self.key && d.trigger?.mode === 'event' && d.trigger.event === trigger.event,
      );
      if (others.length) {
        issues.push({
          code: 'trigger_event_shared',
          severity: 'warning',
          params: { count: others.length, names: others.map((d) => d.name).join(', ').slice(0, 300) },
        });
      }
    }
    return issues;
  }

  /** Validation for the designer: knows which process it is, so self-references resolve. */
  async validateFor(graph: WorkflowGraph, trigger: WorkflowTrigger, organizationId: string, definitionId?: string): Promise<WorkflowIssue[]> {
    const self = definitionId ? await this.definitions.findOne({ where: { id: definitionId, organizationId } }) : null;
    return this.validate(graph, trigger, organizationId, self ? { key: self.key, id: self.id } : {});
  }

  /** Validate the graph, then make this the live version of its key. */
  async publish(id: string, dto: PublishDefinitionDto, organizationId: string, actorUserId: string): Promise<WorkflowDefinition> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(WorkflowDefinition);
      // Lock every version of the key: two publishes of one process serialise.
      const definition = await repo.findOne({ where: { id, organizationId }, lock: { mode: 'pessimistic_write' } });
      if (!definition) throw new NotFoundError('workflow_engine.definition_not_found');
      if (definition.status === WorkflowDefinitionStatus.PUBLISHED) {
        throw new ConflictError('workflow_engine.already_published');
      }
      const live = await repo.findOne({
        where: { organizationId, key: definition.key, status: WorkflowDefinitionStatus.PUBLISHED },
        lock: { mode: 'pessimistic_write' },
      });
      if (live && live.version > definition.version && !dto.rollback) {
        throw new ConflictError('workflow_engine.stale_version', { version: definition.version, live: live.version }, 'workflow_engine.stale_version');
      }

      const issues = await this.validate(definition.graph, definition.trigger, organizationId, { key: definition.key, id: definition.id });
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length) {
        throw new UnprocessableEntityError(
          'workflow_engine.invalid_graph.summary',
          { count: errors.length, issues: errors },
          'workflow_engine.invalid_graph',
        );
      }
      // Warnings do not block, but nobody publishes past one without having seen it: a process goes
      // live only after its author confirmed each warning the server found, not the ones the
      // designer happened to show.
      const warnings = issues.filter((issue) => issue.severity === 'warning');
      if (warnings.length && !dto.acknowledgeWarnings) {
        throw new ConflictError(
          'workflow_engine.publish_has_warnings',
          { count: warnings.length, issues: warnings },
          'workflow_engine.publish_has_warnings',
        );
      }

      if (live) {
        live.status = WorkflowDefinitionStatus.ARCHIVED;
        await repo.save(live);
      }
      definition.status = WorkflowDefinitionStatus.PUBLISHED;
      definition.publishedAt = new Date();
      definition.publishedByUserId = actorUserId;
      return repo.save(definition);
    });
  }

  /**
   * Open the key's draft for revision: the existing one if there is one, else a copy of `id`.
   *
   * There is at most one draft per process (enforced by a unique index too), so pressing «new
   * version» twice opens the same draft instead of scattering invisible ones.
   */
  async createVersion(id: string, organizationId: string, actorUserId: string): Promise<WorkflowDefinition> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(WorkflowDefinition);
      const source = await repo.findOne({ where: { id, organizationId }, lock: { mode: 'pessimistic_write' } });
      if (!source) throw new NotFoundError('workflow_engine.definition_not_found');
      const existing = await repo.findOne({ where: { organizationId, key: source.key, status: WorkflowDefinitionStatus.DRAFT } });
      if (existing) return existing;

      const latest = await repo
        .createQueryBuilder('d')
        .select('MAX(d.version)', 'max')
        .where('d.organization_id = :organizationId AND d.key = :key', { organizationId, key: source.key })
        .getRawOne<{ max: number }>();
      return repo.save(
        repo.create({
          organizationId,
          key: source.key,
          name: source.name,
          description: source.description,
          version: Number(latest?.max ?? source.version) + 1,
          status: WorkflowDefinitionStatus.DRAFT,
          graph: source.graph,
          trigger: source.trigger,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          publishedAt: null,
          publishedByUserId: null,
        }),
      );
    });
  }

  /** Delete a draft (or an archived version nobody runs on). The live version is never deleted. */
  async remove(id: string, organizationId: string): Promise<void> {
    const definition = await this.get(id, organizationId);
    if (definition.status === WorkflowDefinitionStatus.PUBLISHED) {
      throw new ConflictError('workflow_engine.cannot_delete_published');
    }
    const used = await this.instances.count({ where: { organizationId, definitionId: definition.id } });
    if (used > 0) throw new ConflictError('workflow_engine.definition_has_instances', { count: used });
    await this.definitions.delete({ id: definition.id, organizationId });
  }

  /** Withdraw the live version: nothing new starts from it; running instances finish on it. */
  async unpublish(id: string, organizationId: string): Promise<WorkflowDefinition> {
    const definition = await this.get(id, organizationId);
    if (definition.status !== WorkflowDefinitionStatus.PUBLISHED) throw new ConflictError('workflow_engine.not_published');
    definition.status = WorkflowDefinitionStatus.ARCHIVED;
    return this.definitions.save(definition);
  }

  async runningCount(definitionIds: string[], organizationId: string): Promise<number> {
    if (!definitionIds.length) return 0;
    return this.instances.count({ where: { organizationId, definitionId: In(definitionIds), status: WorkflowInstanceStatus.RUNNING } });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private assertStructure(graph: WorkflowGraph, trigger: WorkflowTrigger): void {
    const issues = structuralIssues(graph, trigger);
    if (issues.length) {
      throw new BadRequestError(
        'workflow_engine.invalid_graph.malformed',
        { count: issues.length, issues: issues },
        'workflow_engine.invalid_graph',
      );
    }
  }

  private async nameTaken(name: string, organizationId: string, exceptKey: string | null): Promise<boolean> {
    const qb = this.definitions
      .createQueryBuilder('d')
      .where('d.organization_id = :organizationId', { organizationId })
      .andWhere('lower(d.name) = lower(:name)', { name });
    if (exceptKey) qb.andWhere('d.key <> :key', { key: exceptKey });
    return (await qb.getCount()) > 0;
  }

  private async assertNameFree(name: string, organizationId: string, exceptKey: string | null): Promise<void> {
    if (await this.nameTaken(name, organizationId, exceptKey)) {
      throw new ConflictError('workflow_engine.name_taken', { name }, 'workflow_engine.name_taken');
    }
  }

  /** A unique slug for a new process's key within the tenant. */
  private async freshKey(seed: string, organizationId: string): Promise<string> {
    const base = slugify(seed);
    let candidate = base;
    for (let suffix = 2; ; suffix += 1) {
      const clash = await this.definitions.count({ where: { organizationId, key: candidate } });
      if (clash === 0) return candidate;
      candidate = `${base.slice(0, 110)}-${suffix}`;
    }
  }
}

const FATAL_CODES: ReadonlySet<string> = new Set([
  'graph_malformed', 'too_many_nodes', 'too_many_edges', 'node_malformed', 'node_bad_id', 'node_bad_type',
  'duplicate_node_id', 'edge_malformed', 'edge_dangling', 'duplicate_edge_id', 'config_malformed',
]);

/** The process keys a graph starts through `start_workflow` steps. */
function subprocessKeys(graph: WorkflowGraph | null | undefined): string[] {
  return (graph?.nodes ?? [])
    .filter((node) => node.config?.action === 'start_workflow')
    .map((node) => String(node.config?.actionParams?.['workflowKey'] ?? ''))
    .filter(Boolean);
}

/** Whether starting `from` can, through any chain of subprocesses, start `target` again. */
function reaches(from: string, target: string, startsOf: ReadonlyMap<string, string[]>): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const key = stack.pop() as string;
    if (key === target) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    stack.push(...(startsOf.get(key) ?? []));
  }
  return false;
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  return slug || 'workflow';
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}
