import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { NotFoundError } from '../i18n/localized.exception';
import { WorkflowDefinition } from './entities/workflow-definition.entity';
import { WorkflowInstance } from './entities/workflow-instance.entity';
import { WorkflowTask, WorkflowTaskStatus } from './entities/workflow-task.entity';
import { TaskActor, WorkflowEngineService } from './workflow-engine.service';
import { WorkflowDirectoryService } from './workflow-directory.service';
import { CompleteTaskDto } from './dto/workflow.dto';

/** A task as the inbox shows it: with what it is about and enough data to decide without digging. */
export interface InboxTask extends WorkflowTask {
  subject: WorkflowInstance['subject'];
  definitionName: string | null;
  definitionVersion: number | null;
  instanceStatus: WorkflowInstance['status'] | null;
  startedByName: string | null;
  assigneeName: string | null;
  completedByName: string | null;
  /** The process variables worth showing at decision time: declared ones, in declared order. */
  facts: Array<{ name: string; label: string | null; type: string; value: unknown }>;
  overdue: boolean;
}

const MAX_FACTS = 12;

/**
 * The human side of a workflow: the task inbox and completing a task.
 *
 * A task names who may act — a specific user, or any holder of a role — and the engine enforces it
 * inside the same locked transaction that completes the task, so the check and the decision can
 * never be separated by a concurrent change.
 */
@Injectable()
export class WorkflowTasksService {
  constructor(
    @InjectRepository(WorkflowTask)
    private readonly tasks: Repository<WorkflowTask>,
    @InjectRepository(WorkflowInstance)
    private readonly instances: Repository<WorkflowInstance>,
    @InjectRepository(WorkflowDefinition)
    private readonly definitions: Repository<WorkflowDefinition>,
    private readonly engine: WorkflowEngineService,
    private readonly directory: WorkflowDirectoryService,
  ) {}

  /**
   * The tasks this person may act on (`open`), or the ones they decided recently (`done`).
   */
  async inbox(organizationId: string, actor: TaskActor, view: 'open' | 'done' = 'open'): Promise<InboxTask[]> {
    const qb = this.tasks.createQueryBuilder('t').where('t.organization_id = :organizationId', { organizationId });
    if (view === 'open') {
      qb.andWhere('t.status = :status', { status: WorkflowTaskStatus.OPEN }).andWhere(
        new Brackets((w) => {
          w.where('t.assignee_user_id = :userId', { userId: actor.userId });
          if (actor.roleIds.length) {
            w.orWhere('(t.assignee_user_id IS NULL AND t.assignee_role_id IN (:...roleIds))', { roleIds: [...actor.roleIds] });
          }
        }),
      );
      qb.orderBy('t.due_at', 'ASC', 'NULLS LAST').addOrderBy('t.created_at', 'ASC');
    } else {
      qb.andWhere('t.completed_by_user_id = :userId', { userId: actor.userId })
        .andWhere('t.status = :status', { status: WorkflowTaskStatus.COMPLETED })
        .orderBy('t.completed_at', 'DESC')
        .take(100);
    }
    return this.decorate(await qb.getMany(), organizationId);
  }

  async get(id: string, organizationId: string): Promise<InboxTask> {
    const task = await this.tasks.findOne({ where: { id, organizationId } });
    if (!task) throw new NotFoundError('workflow_engine.task_not_found');
    const [decorated] = await this.decorate([task], organizationId);
    return decorated;
  }

  complete(id: string, organizationId: string, dto: CompleteTaskDto, actor: TaskActor): Promise<WorkflowInstance> {
    return this.engine.completeTask(id, organizationId, { outcome: dto.outcome, formData: dto.formData, comment: dto.comment }, actor);
  }

  /** Open approval-type tasks for the approvals centre, decorated the same way. */
  async openApprovals(organizationId: string): Promise<InboxTask[]> {
    const open = await this.tasks.find({
      where: { organizationId, status: WorkflowTaskStatus.OPEN, nodeType: 'approval' },
      order: { createdAt: 'ASC' },
      take: 500,
    });
    return this.decorate(open, organizationId);
  }

  private async decorate(tasks: WorkflowTask[], organizationId: string): Promise<InboxTask[]> {
    if (tasks.length === 0) return [];
    const instances = await this.instances.find({ where: { organizationId, id: In([...new Set(tasks.map((t) => t.instanceId))]) } });
    const instanceBy = new Map(instances.map((i) => [i.id, i]));
    const definitions = instances.length
      ? await this.definitions.find({ where: { organizationId, id: In([...new Set(instances.map((i) => i.definitionId))]) } })
      : [];
    const definitionBy = new Map(definitions.map((d) => [d.id, d]));
    const names = await this.directory.names(
      organizationId,
      [...instances.map((i) => i.startedByUserId), ...tasks.flatMap((t) => [t.assigneeUserId, t.completedByUserId])],
    );
    const now = Date.now();

    return tasks.map((task) => {
      const instance = instanceBy.get(task.instanceId);
      const definition = instance ? definitionBy.get(instance.definitionId) : undefined;
      const context = instance?.context ?? {};
      const declared = definition?.graph.variables ?? [];
      const facts = declared
        .filter((variable) => context[variable.name] !== undefined && context[variable.name] !== null && context[variable.name] !== '')
        .slice(0, MAX_FACTS)
        .map((variable) => ({ name: variable.name, label: variable.label ?? null, type: variable.type, value: context[variable.name] }));
      return Object.assign(task, {
        subject: instance?.subject ?? null,
        definitionName: definition?.name ?? null,
        definitionVersion: definition?.version ?? null,
        instanceStatus: instance?.status ?? null,
        startedByName: instance?.startedByUserId ? (names.get(instance.startedByUserId) ?? null) : null,
        assigneeName: task.assigneeUserId ? (names.get(task.assigneeUserId) ?? null) : null,
        completedByName: task.completedByUserId ? (names.get(task.completedByUserId) ?? null) : null,
        facts,
        overdue: task.status === WorkflowTaskStatus.OPEN && !!task.dueAt && task.dueAt.getTime() < now,
      });
    });
  }
}
