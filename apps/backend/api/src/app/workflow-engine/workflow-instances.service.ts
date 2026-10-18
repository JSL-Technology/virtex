import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { ConflictError, NotFoundError } from '../i18n/localized.exception';
import { WorkflowDefinition, WorkflowDefinitionStatus } from './entities/workflow-definition.entity';
import { WorkflowInstance } from './entities/workflow-instance.entity';
import { WorkflowTask } from './entities/workflow-task.entity';
import { WorkflowTransition } from './entities/workflow-transition.entity';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowDirectoryService } from './workflow-directory.service';
import { ListInstancesQueryDto, StartInstanceDto } from './dto/workflow.dto';

export interface WorkflowInstanceRow extends WorkflowInstance {
  definitionName: string | null;
  definitionKey: string | null;
  /** Names of the nodes the run is currently on (waiting or active). */
  currentSteps: string[];
  /** The steps the run waits on, with their type so a step without a name reads as «Temporizador», not `timer`. */
  currentNodes: { id: string; name: string | null; type: string }[];
  startedByName: string | null;
  openTaskCount: number;
  /** For a failed run: the parameters of its failure's catalogue key (which step, which outcome). */
  errorParams: Record<string, unknown> | null;
}

export interface WorkflowInstancePage {
  items: WorkflowInstanceRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** An instance with everything the runtime view draws: its tasks, its timeline, and its design. */
export interface WorkflowInstanceDetail {
  instance: WorkflowInstanceRow;
  tasks: WorkflowTask[];
  transitions: WorkflowTransition[];
  definition: WorkflowDefinition | null;
  /** Display names for every user id that appears in the run (starter, actors, assignees). */
  people: Record<string, string>;
  /** Role names for the roles open tasks are assigned to. */
  roles: Record<string, string>;
  children: Array<Pick<WorkflowInstance, 'id' | 'status' | 'createdAt'> & { definitionName: string | null }>;
}

/** The run side: starting, listing, reading, cancelling and retrying instances. */
@Injectable()
export class WorkflowInstancesService {
  constructor(
    @InjectRepository(WorkflowInstance)
    private readonly instances: Repository<WorkflowInstance>,
    @InjectRepository(WorkflowTask)
    private readonly tasks: Repository<WorkflowTask>,
    @InjectRepository(WorkflowTransition)
    private readonly transitions: Repository<WorkflowTransition>,
    @InjectRepository(WorkflowDefinition)
    private readonly definitionsRepo: Repository<WorkflowDefinition>,
    private readonly definitions: WorkflowDefinitionsService,
    private readonly engine: WorkflowEngineService,
    private readonly directory: WorkflowDirectoryService,
  ) {}

  async list(
    organizationId: string,
    query: ListInstancesQueryDto,
    viewer: { userId: string; roleIds: readonly string[] },
  ): Promise<WorkflowInstancePage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const qb = this.instances
      .createQueryBuilder('i')
      .leftJoin(WorkflowDefinition, 'd', 'd.id = i.definition_id AND d.organization_id = i.organization_id')
      .where('i.organization_id = :organizationId', { organizationId })
      // With skip/take TypeORM pages through entity ids, which needs the PROPERTY name here.
      .orderBy('i.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (query.status) qb.andWhere('i.status = :status', { status: query.status });
    if (query.definitionId) qb.andWhere('i.definition_id = :definitionId', { definitionId: query.definitionId });
    if (query.key) qb.andWhere('d.key = :key', { key: query.key });
    if (query.from) qb.andWhere('i.created_at >= :from', { from: query.from });
    if (query.to) qb.andWhere('i.created_at <= :to', { to: query.to });
    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where(`lower(coalesce(i.subject->>'label', '')) LIKE :term`, { term })
            .orWhere('lower(d.name) LIKE :term', { term })
            .orWhere(`lower(coalesce(i.result, '')) LIKE :term`, { term }),
        ),
      );
    }
    if (query.scope === 'mine') {
      qb.andWhere(
        new Brackets((w) =>
          w.where('i.started_by_user_id = :userId', { userId: viewer.userId }).orWhere(
            `EXISTS (SELECT 1 FROM workflow_tasks t WHERE t.instance_id = i.id AND t.organization_id = i.organization_id
               AND (t.assignee_user_id = :userId OR t.completed_by_user_id = :userId
                    OR (t.assignee_role_id IS NOT NULL AND t.assignee_role_id = ANY(:roleIds))))`,
            { userId: viewer.userId, roleIds: viewer.roleIds.length ? [...viewer.roleIds] : ['00000000-0000-0000-0000-000000000000'] },
          ),
        ),
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return { items: await this.decorate(items, organizationId), total, page, pageSize };
  }

  async get(id: string, organizationId: string): Promise<WorkflowInstance> {
    const instance = await this.instances.findOne({ where: { id, organizationId } });
    if (!instance) throw new NotFoundError('workflow_engine.instance_not_found');
    return instance;
  }

  async detail(id: string, organizationId: string): Promise<WorkflowInstanceDetail> {
    const instance = await this.get(id, organizationId);
    const [tasks, transitions, definition, children] = await Promise.all([
      this.tasks.find({ where: { instanceId: id, organizationId }, order: { createdAt: 'ASC' } }),
      this.transitions.find({ where: { instanceId: id, organizationId }, order: { createdAt: 'ASC' } }),
      this.definitions.get(instance.definitionId, organizationId).catch(() => null),
      this.instances.find({ where: { parentInstanceId: id, organizationId }, order: { createdAt: 'ASC' } }),
    ]);
    const [row] = await this.decorate([instance], organizationId);
    const people = await this.directory.names(organizationId, [
      instance.startedByUserId,
      ...transitions.map((t) => t.actorUserId),
      ...tasks.flatMap((t) => [t.assigneeUserId, t.completedByUserId]),
    ]);
    const childRows = await this.decorate(children, organizationId);
    const roleIds = new Set(tasks.map((t) => t.assigneeRoleId).filter((id): id is string => !!id));
    const roles = roleIds.size ? (await this.directory.roles(organizationId)).filter((r) => roleIds.has(r.id)) : [];
    return {
      instance: row,
      tasks,
      transitions,
      definition,
      people: Object.fromEntries(people),
      roles: Object.fromEntries(roles.map((r) => [r.id, r.name])),
      children: childRows.map((child) => ({ id: child.id, status: child.status, createdAt: child.createdAt, definitionName: child.definitionName })),
    };
  }

  async start(definitionId: string, dto: StartInstanceDto, organizationId: string, actorUserId: string): Promise<WorkflowInstance> {
    const definition = await this.definitions.get(definitionId, organizationId);
    if (definition.status !== WorkflowDefinitionStatus.PUBLISHED) {
      throw new ConflictError('workflow_engine.definition_not_published');
    }
    // An event-driven process may also be started by hand (to test it, or for a missed event);
    // the person is recorded as its starter.
    return this.engine.start(definition, { context: dto.context ?? {}, subject: dto.subject ?? null, startedByUserId: actorUserId }, organizationId);
  }

  cancel(id: string, organizationId: string, actorUserId: string, reason: string): Promise<WorkflowInstance> {
    return this.engine.cancel(id, organizationId, actorUserId, reason);
  }

  retry(id: string, organizationId: string, actorUserId: string): Promise<WorkflowInstance> {
    return this.engine.retry(id, organizationId, actorUserId);
  }

  private async decorate(instances: WorkflowInstance[], organizationId: string): Promise<WorkflowInstanceRow[]> {
    if (instances.length === 0) return [];
    const definitionIds = [...new Set(instances.map((i) => i.definitionId))];
    const definitions = await this.definitionsRepo
      .createQueryBuilder('d')
      .where('d.organization_id = :organizationId AND d.id IN (:...ids)', { organizationId, ids: definitionIds })
      .getMany();
    const byId = new Map(definitions.map((d) => [d.id, d]));
    const names = await this.directory.names(organizationId, instances.map((i) => i.startedByUserId));
    const open = await this.engine.openTasksFor(instances.map((i) => i.id), organizationId);
    const openBy = new Map<string, number>();
    for (const task of open) openBy.set(task.instanceId, (openBy.get(task.instanceId) ?? 0) + 1);
    // `error` holds the failure's catalogue key; its parameters live on the error transition.
    const failedIds = instances.filter((i) => i.status === 'FAILED').map((i) => i.id);
    const errorParams = new Map<string, Record<string, unknown>>();
    if (failedIds.length) {
      const errors = await this.transitions
        .createQueryBuilder('t')
        .where('t.organization_id = :organizationId AND t.instance_id IN (:...ids) AND t.kind = :kind', { organizationId, ids: failedIds, kind: 'error' })
        .orderBy('t.created_at', 'ASC')
        .getMany();
      for (const error of errors) errorParams.set(error.instanceId, ((error.detail as { params?: Record<string, unknown> } | null)?.params ?? {}));
    }

    return instances.map((instance) => {
      const definition = byId.get(instance.definitionId);
      const nodes = new Map((definition?.graph.nodes ?? []).map((node) => [node.id, node]));
      const currentNodes = instance.tokens
        .filter((token) => token.state !== 'done')
        .map((token) => {
          const node = nodes.get(token.nodeId);
          return { id: token.nodeId, name: node?.name?.trim() || null, type: node?.type ?? 'task' };
        });
      const currentSteps = currentNodes.map((node) => node.name ?? node.type);
      return Object.assign(instance, {
        definitionName: definition?.name ?? null,
        definitionKey: definition?.key ?? null,
        currentSteps,
        currentNodes,
        startedByName: instance.startedByUserId ? (names.get(instance.startedByUserId) ?? null) : null,
        openTaskCount: openBy.get(instance.id) ?? 0,
        errorParams: errorParams.get(instance.id) ?? null,
      });
    });
  }
}
