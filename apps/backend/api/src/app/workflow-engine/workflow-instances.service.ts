import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { WorkflowDefinition, WorkflowDefinitionStatus } from './entities/workflow-definition.entity';
import { WorkflowInstance, WorkflowInstanceStatus } from './entities/workflow-instance.entity';
import { WorkflowTask } from './entities/workflow-task.entity';
import { WorkflowTransition } from './entities/workflow-transition.entity';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { StartInstanceDto } from './dto/workflow.dto';

/** An instance with everything the runtime view draws: its tasks, its timeline, and its design. */
export interface WorkflowInstanceDetail {
  instance: WorkflowInstance;
  tasks: WorkflowTask[];
  transitions: WorkflowTransition[];
  definition: WorkflowDefinition | null;
}

/** The run side: starting, listing, reading and cancelling instances. */
@Injectable()
export class WorkflowInstancesService {
  constructor(
    @InjectRepository(WorkflowInstance)
    private readonly instances: Repository<WorkflowInstance>,
    @InjectRepository(WorkflowTask)
    private readonly tasks: Repository<WorkflowTask>,
    @InjectRepository(WorkflowTransition)
    private readonly transitions: Repository<WorkflowTransition>,
    private readonly definitions: WorkflowDefinitionsService,
    private readonly engine: WorkflowEngineService,
  ) {}

  list(
    organizationId: string,
    filter: { status?: WorkflowInstanceStatus; definitionId?: string } = {},
  ): Promise<WorkflowInstance[]> {
    const where: FindOptionsWhere<WorkflowInstance> = { organizationId };
    if (filter.status) where.status = filter.status;
    if (filter.definitionId) where.definitionId = filter.definitionId;
    return this.instances.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }

  async get(id: string, organizationId: string): Promise<WorkflowInstance> {
    const instance = await this.instances.findOne({ where: { id, organizationId } });
    if (!instance) throw new NotFoundError('workflow_engine.instance_not_found');
    return instance;
  }

  async detail(id: string, organizationId: string): Promise<WorkflowInstanceDetail> {
    const instance = await this.get(id, organizationId);
    const [tasks, transitions, definition] = await Promise.all([
      this.tasks.find({ where: { instanceId: id, organizationId }, order: { createdAt: 'ASC' } }),
      this.transitions.find({ where: { instanceId: id, organizationId }, order: { createdAt: 'ASC' } }),
      this.definitions.get(instance.definitionId, organizationId).catch(() => null),
    ]);
    return { instance, tasks, transitions, definition };
  }

  async start(
    definitionId: string,
    dto: StartInstanceDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<WorkflowInstance> {
    const definition = await this.definitions.get(definitionId, organizationId);
    if (definition.status !== WorkflowDefinitionStatus.PUBLISHED) {
      throw new BadRequestError('workflow_engine.definition_not_published');
    }
    return this.engine.start(
      definition,
      { context: dto.context ?? {}, subject: dto.subject, startedByUserId: actorUserId },
      organizationId,
    );
  }

  async cancel(id: string, organizationId: string, actorUserId: string): Promise<WorkflowInstance> {
    const instance = await this.get(id, organizationId);
    return this.engine.cancel(instance, actorUserId);
  }
}
