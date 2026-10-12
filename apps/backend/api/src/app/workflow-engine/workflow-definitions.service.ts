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
import { isKnownWorkflowEvent } from './events/workflow-event.catalogue';
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
  async validate(graph: WorkflowGraph, trigger: WorkflowTrigger, organizationId: string): Promise<WorkflowIssue[]> {
    const structural = structuralIssues(graph, trigger);
    if (structural.length) return structural;
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
    const [knownUsers, knownRoles] = await Promise.all([
      this.directory.userIdSet(organizationId, userIds),
      this.directory.roleIdSet(organizationId),
    ]);
    const issues = semanticIssues(graph, trigger, {
      actionParams: (key) => this.actions.paramsOf(key),
      isKnownEvent: isKnownWorkflowEvent,
      userIds: knownUsers,
      roleIds: knownRoles,
    });
    // `start_workflow` names another process by key: it must exist and be live.
    for (const node of graph.nodes) {
      if (node.config?.action !== 'start_workflow') continue;
      const key = String(node.config.actionParams?.['workflowKey'] ?? '');
      if (!key) continue;
      const target = await this.getPublishedByKey(key, organizationId);
      if (!target) issues.push({ code: 'subprocess_unknown', severity: 'error', nodeId: node.id, params: { key } });
    }
    return issues;
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

      const issues = await this.validate(definition.graph, definition.trigger, organizationId);
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length) {
        throw new UnprocessableEntityError(
          'workflow_engine.invalid_graph.summary',
          { count: errors.length, issues: errors },
          'workflow_engine.invalid_graph',
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
