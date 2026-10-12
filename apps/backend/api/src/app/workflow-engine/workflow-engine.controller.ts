import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowInstancesService } from './workflow-instances.service';
import { WorkflowTasksService } from './workflow-tasks.service';
import { WorkflowTriggerService } from './workflow-trigger.service';
import {
  CompleteTaskDto,
  CreateWorkflowDefinitionDto,
  FireEventDto,
  ListInstancesQueryDto,
  StartInstanceDto,
  UpdateWorkflowDefinitionDto,
} from './dto/workflow.dto';

/**
 * The business-workflow API: design, run, and act.
 *
 * Three verbs, three permissions. `WORKFLOW_DESIGN` authors and publishes the process graphs;
 * `WORKFLOW_RUN` starts, cancels and reads instances; `WORKFLOW_TASK_ACT` completes the human tasks
 * a running process raises — the one an approver needs without the one that lets them rewrite the
 * rules. Reading a design is `WORKFLOW_VIEW`, so an auditor can see the process without touching it.
 */
@ApiTags('Workflow engine')
@ApiBearerAuth()
@Controller('workflow-engine')
export class WorkflowEngineController {
  constructor(
    private readonly definitions: WorkflowDefinitionsService,
    private readonly instances: WorkflowInstancesService,
    private readonly tasks: WorkflowTasksService,
    private readonly triggers: WorkflowTriggerService,
  ) {}

  private roleIdsOf(user: AuthenticatedUser): string[] {
    return (user.roles ?? []).map((role) => role.id);
  }

  // ── Definitions ──────────────────────────────────────────────────────────────

  @Get('definitions')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  @ApiOperation({ summary: 'Lista las definiciones de flujo de trabajo del inquilino.' })
  listDefinitions(@CurrentUser() user: AuthenticatedUser) {
    return this.definitions.list(user.organizationId);
  }

  @Get('definitions/:id')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  getDefinition(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.get(id, user.organizationId);
  }

  @Post('definitions')
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'Crea una definición en borrador.' })
  createDefinition(
    @Body() dto: CreateWorkflowDefinitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.definitions.create(dto, user.organizationId, user.id);
  }

  @Patch('definitions/:id')
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  updateDefinition(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateWorkflowDefinitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.definitions.update(id, dto, user.organizationId);
  }

  @Post('definitions/:id/publish')
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'Valida y publica una definición, archivando la versión anterior.' })
  publishDefinition(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.publish(id, user.organizationId);
  }

  @Post('definitions/:id/versions')
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'Clona una definición en una nueva versión en borrador.' })
  newVersion(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.createVersion(id, user.organizationId, user.id);
  }

  @Delete('definitions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  deleteDefinition(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.remove(id, user.organizationId);
  }

  @Get('actions')
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'El catálogo de acciones automáticas disponibles para el diseñador.' })
  actionCatalogue() {
    return this.definitions.actionCatalogue();
  }

  // ── Instances ────────────────────────────────────────────────────────────────

  @Get('instances')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  listInstances(@Query() query: ListInstancesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.instances.list(user.organizationId, query);
  }

  @Get('instances/:id')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  @ApiOperation({ summary: 'Una instancia con sus tareas, su cronología y su diseño.' })
  getInstance(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.instances.detail(id, user.organizationId);
  }

  @Post('definitions/:id/start')
  @HasPermission(PERMISSIONS.WORKFLOW_RUN)
  @ApiOperation({ summary: 'Inicia manualmente una instancia de una definición publicada.' })
  startInstance(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: StartInstanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.instances.start(id, dto, user.organizationId, user.id);
  }

  @Post('instances/:id/cancel')
  @HasPermission(PERMISSIONS.WORKFLOW_RUN)
  cancelInstance(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.instances.cancel(id, user.organizationId, user.id);
  }

  @Post('events')
  @HasPermission(PERMISSIONS.WORKFLOW_RUN)
  @ApiOperation({ summary: 'Dispara un evento de negocio que inicia los flujos suscritos a él.' })
  fireEvent(@Body() dto: FireEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.triggers
      .fire(user.organizationId, dto.event, {
        context: dto.context,
        subject: dto.subject,
        actorUserId: user.id,
      })
      .then((started) => ({ started }));
  }

  // ── Tasks ────────────────────────────────────────────────────────────────────

  @Get('tasks')
  @HasPermission(PERMISSIONS.WORKFLOW_TASK_ACT)
  @ApiOperation({ summary: 'La bandeja de tareas de flujo de trabajo del usuario.' })
  myTasks(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.inbox(user.organizationId, user.id, this.roleIdsOf(user));
  }

  @Post('tasks/:id/complete')
  @HasPermission(PERMISSIONS.WORKFLOW_TASK_ACT)
  @ApiOperation({ summary: 'Completa una tarea con un resultado y avanza la instancia.' })
  completeTask(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CompleteTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.complete(id, user.organizationId, dto, {
      userId: user.id,
      roleIds: this.roleIdsOf(user),
    });
  }
}
