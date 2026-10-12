import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ForbiddenError, NotFoundError } from '../i18n/localized.exception';
import { WorkflowInstance } from './entities/workflow-instance.entity';
import { WorkflowTask, WorkflowTaskStatus } from './entities/workflow-task.entity';
import { WorkflowEngineService } from './workflow-engine.service';
import { CompleteTaskDto } from './dto/workflow.dto';

/** Who is acting on a task, and under what authority — from the principal, never the request body. */
export interface TaskActor {
  userId: string;
  roleIds: string[];
}

/**
 * The human side of a workflow: the task inbox and completing a task.
 *
 * A task names who may act — a specific user, or any holder of a role — and that is enforced here
 * before the engine is touched: the person completing a task must be its assignee or hold its role,
 * so an outcome is always attributable to someone entitled to decide it. Completing a task is
 * delegated to the engine, which is what moves the instance on.
 */
@Injectable()
export class WorkflowTasksService {
  constructor(
    @InjectRepository(WorkflowTask)
    private readonly tasks: Repository<WorkflowTask>,
    private readonly engine: WorkflowEngineService,
  ) {}

  /** The open tasks this person may act on: assigned to them, or to a role they hold. */
  inbox(organizationId: string, userId: string, roleIds: string[]): Promise<WorkflowTask[]> {
    const where: FindOptionsWhere<WorkflowTask>[] = [
      { organizationId, status: WorkflowTaskStatus.OPEN, assigneeUserId: userId },
    ];
    for (const roleId of roleIds) {
      where.push({ organizationId, status: WorkflowTaskStatus.OPEN, assigneeRoleId: roleId });
    }
    return this.tasks.find({ where, order: { createdAt: 'ASC' } });
  }

  forInstance(instanceId: string, organizationId: string): Promise<WorkflowTask[]> {
    return this.tasks.find({ where: { instanceId, organizationId }, order: { createdAt: 'ASC' } });
  }

  async get(id: string, organizationId: string): Promise<WorkflowTask> {
    const task = await this.tasks.findOne({ where: { id, organizationId } });
    if (!task) throw new NotFoundError('workflow_engine.task_not_found');
    return task;
  }

  async complete(
    id: string,
    organizationId: string,
    dto: CompleteTaskDto,
    actor: TaskActor,
  ): Promise<WorkflowInstance> {
    const task = await this.get(id, organizationId);
    this.assertCanAct(task, actor);
    return this.engine.completeTask(task, {
      outcome: dto.outcome,
      formData: dto.formData,
      actorUserId: actor.userId,
    });
  }

  private assertCanAct(task: WorkflowTask, actor: TaskActor): void {
    if (task.assigneeUserId) {
      if (task.assigneeUserId !== actor.userId) throw new ForbiddenError('workflow_engine.not_your_task');
      return;
    }
    if (task.assigneeRoleId && !actor.roleIds.includes(task.assigneeRoleId)) {
      throw new ForbiddenError('workflow_engine.not_your_task');
    }
    // An unassigned task is open to anyone the controller's permission already let through.
  }
}
