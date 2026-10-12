import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import {
  WorkflowDefinition,
  WorkflowDefinitionStatus,
} from './entities/workflow-definition.entity';
import { WorkflowInstance, WorkflowInstanceStatus } from './entities/workflow-instance.entity';
import { WorkflowGraph, WorkflowNodeType, WorkflowTrigger } from './contracts/workflow-graph';
import { WorkflowActionRegistry } from './workflow-action.registry';
import {
  CreateWorkflowDefinitionDto,
  UpdateWorkflowDefinitionDto,
} from './dto/workflow.dto';

const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };
const MANUAL_TRIGGER: WorkflowTrigger = { mode: 'manual' };

/**
 * The design side: creating, versioning, validating and publishing workflow definitions.
 *
 * A design is editable only while DRAFT; publishing freezes it and makes it the one PUBLISHED
 * version of its `key`, archiving the version it replaces so that instances already running on the
 * old one still resolve it. Revising a published process is `createVersion`, which clones it into a
 * fresh draft — the design never mutates under a running instance.
 */
@Injectable()
export class WorkflowDefinitionsService {
  constructor(
    @InjectRepository(WorkflowDefinition)
    private readonly definitions: Repository<WorkflowDefinition>,
    @InjectRepository(WorkflowInstance)
    private readonly instances: Repository<WorkflowInstance>,
    private readonly actions: WorkflowActionRegistry,
  ) {}

  list(organizationId: string): Promise<WorkflowDefinition[]> {
    return this.definitions.find({
      where: { organizationId },
      order: { updatedAt: 'DESC' },
    });
  }

  async get(id: string, organizationId: string): Promise<WorkflowDefinition> {
    const definition = await this.definitions.findOne({ where: { id, organizationId } });
    if (!definition) throw new NotFoundError('workflow_engine.definition_not_found');
    return definition;
  }

  async create(
    dto: CreateWorkflowDefinitionDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<WorkflowDefinition> {
    const key = await this.freshKey(dto.key || dto.name, organizationId);
    return this.definitions.save(
      this.definitions.create({
        organizationId,
        key,
        name: dto.name.trim(),
        description: dto.description ?? null,
        version: 1,
        status: WorkflowDefinitionStatus.DRAFT,
        graph: (dto.graph as WorkflowGraph) ?? EMPTY_GRAPH,
        trigger: (dto.trigger as WorkflowTrigger) ?? MANUAL_TRIGGER,
        createdByUserId: actorUserId,
      }),
    );
  }

  async update(
    id: string,
    dto: UpdateWorkflowDefinitionDto,
    organizationId: string,
  ): Promise<WorkflowDefinition> {
    const definition = await this.get(id, organizationId);
    if (definition.status !== WorkflowDefinitionStatus.DRAFT) {
      throw new BadRequestError('workflow_engine.only_draft_editable');
    }
    if (dto.name !== undefined) definition.name = dto.name.trim();
    if (dto.description !== undefined) definition.description = dto.description;
    if (dto.graph !== undefined) definition.graph = dto.graph as WorkflowGraph;
    if (dto.trigger !== undefined) definition.trigger = dto.trigger as WorkflowTrigger;
    return this.definitions.save(definition);
  }

  /** Validate the graph, then make this the live version of its key. */
  async publish(id: string, organizationId: string): Promise<WorkflowDefinition> {
    const definition = await this.get(id, organizationId);
    this.validateGraph(definition.graph);

    // Archive the version this one replaces, so there is never two live versions of one key.
    await this.definitions.update(
      {
        organizationId,
        key: definition.key,
        status: WorkflowDefinitionStatus.PUBLISHED,
        id: Not(definition.id),
      },
      { status: WorkflowDefinitionStatus.ARCHIVED },
    );

    definition.status = WorkflowDefinitionStatus.PUBLISHED;
    return this.definitions.save(definition);
  }

  /** Clone a definition into a new DRAFT version of the same key, for revising a published process. */
  async createVersion(
    id: string,
    organizationId: string,
    actorUserId: string,
  ): Promise<WorkflowDefinition> {
    const source = await this.get(id, organizationId);
    const latest = await this.definitions
      .createQueryBuilder('d')
      .select('MAX(d.version)', 'max')
      .where('d.organization_id = :organizationId AND d.key = :key', {
        organizationId,
        key: source.key,
      })
      .getRawOne<{ max: number }>();
    const nextVersion = Number(latest?.max ?? source.version) + 1;

    return this.definitions.save(
      this.definitions.create({
        organizationId,
        key: source.key,
        name: source.name,
        description: source.description,
        version: nextVersion,
        status: WorkflowDefinitionStatus.DRAFT,
        graph: source.graph,
        trigger: source.trigger,
        createdByUserId: actorUserId,
      }),
    );
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const definition = await this.get(id, organizationId);
    if (definition.status === WorkflowDefinitionStatus.PUBLISHED) {
      throw new BadRequestError('workflow_engine.cannot_delete_published');
    }
    const running = await this.instances.count({
      where: {
        organizationId,
        definitionId: definition.id,
        status: WorkflowInstanceStatus.RUNNING,
      },
    });
    if (running > 0) throw new BadRequestError('workflow_engine.definition_has_running_instances');
    await this.definitions.delete({ id: definition.id, organizationId });
  }

  /** The palette the designer offers for ACTION nodes. */
  actionCatalogue(): Array<{ key: string; labelKey: string }> {
    return this.actions.catalogue();
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Refuse a graph that cannot run.
   *
   * The checks are the ones whose failure would otherwise surface at runtime as a stuck or failed
   * instance: exactly one start, at least one end, no edge pointing at a node that is not there,
   * every non-end node with a way out, and every action a registered one. Validation at publish is
   * the moment to catch these, because after it the design is frozen and instances depend on it.
   */
  validateGraph(graph: WorkflowGraph): void {
    const nodes = graph?.nodes ?? [];
    const edges = graph?.edges ?? [];

    const fail = (reason: string, params: Record<string, unknown> = {}) => {
      throw new BadRequestError(`workflow_engine.invalid_graph.${reason}`, params);
    };

    const starts = nodes.filter((node) => node.type === WorkflowNodeType.START);
    if (starts.length !== 1) fail('one_start');
    if (!nodes.some((node) => node.type === WorkflowNodeType.END)) fail('need_end');

    const ids = new Set(nodes.map((node) => node.id));
    if (ids.size !== nodes.length) fail('duplicate_node_id');
    for (const edge of edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) fail('edge_dangling', { edge: edge.id });
    }

    const hasOutgoing = new Set(edges.map((edge) => edge.from));
    for (const node of nodes) {
      if (node.type !== WorkflowNodeType.END && !hasOutgoing.has(node.id)) {
        fail('node_no_exit', { node: node.name ?? node.id });
      }
      if (node.type === WorkflowNodeType.ACTION) {
        const key = node.config?.action;
        if (!key || !this.actions.get(key)) fail('unknown_action', { node: node.name ?? node.id });
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** A unique slug for a new process's key within the tenant. */
  private async freshKey(seed: string, organizationId: string): Promise<string> {
    const base = slugify(seed);
    let candidate = base;
    for (let suffix = 2; ; suffix += 1) {
      const clash = await this.definitions.count({ where: { organizationId, key: candidate } });
      if (clash === 0) return candidate;
      candidate = `${base}-${suffix}`;
    }
  }
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100);
  return slug || 'workflow';
}
