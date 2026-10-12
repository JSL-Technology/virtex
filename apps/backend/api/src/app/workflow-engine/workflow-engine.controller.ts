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
import { hasPermission } from '@virteex/shared/util-auth';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { BadRequestError, ForbiddenError } from '../i18n/localized.exception';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowInstancesService } from './workflow-instances.service';
import { WorkflowTasksService } from './workflow-tasks.service';
import { WorkflowTriggerService } from './workflow-trigger.service';
import { WorkflowActionRegistry } from './workflow-action.registry';
import { WorkflowDirectoryService } from './workflow-directory.service';
import { CUSTOM_EVENT_PREFIX, WORKFLOW_EVENT_CATALOGUE } from './events/workflow-event.catalogue';
import {
  AssigneeQueryDto,
  CancelInstanceDto,
  CompleteTaskDto,
  CreateWorkflowDefinitionDto,
  DuplicateDefinitionDto,
  FireEventDto,
  ListDefinitionsQueryDto,
  ListInstancesQueryDto,
  PublishDefinitionDto,
  StartInstanceDto,
  UpdateWorkflowDefinitionDto,
  ValidateDefinitionDto,
} from './dto/workflow.dto';

/**
 * The business-workflow API: design, run, and act.
 *
 * Four grants. `WORKFLOW_DESIGN` authors, validates and publishes process graphs; `WORKFLOW_RUN`
 * starts, cancels and retries instances; `WORKFLOW_TASK_ACT` completes the human tasks a running
 * process raises — the approver's grant, held apart from the designer's so writing the rules and
 * acting under them stay different jobs; `WORKFLOW_VIEW` reads designs and runs, so an auditor can
 * see a process without touching it.
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
    private readonly actions: WorkflowActionRegistry,
    private readonly directory: WorkflowDirectoryService,
  ) {}

  private actorOf(user: AuthenticatedUser) {
    return { userId: user.id, roleIds: (user.roles ?? []).map((role) => role.id) };
  }

  // ── Definitions ──────────────────────────────────────────────────────────────

  @Get('definitions/catalogue')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  @ApiOperation({ summary: 'El catálogo de procesos: uno por clave, con su versión publicada, su borrador y su historial.' })
  catalogue(@Query() query: ListDefinitionsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.catalogue(user.organizationId, query.search);
  }

  @Get('definitions')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  @ApiOperation({ summary: 'Lista las definiciones (todas las versiones) del inquilino.' })
  listDefinitions(@Query() query: ListDefinitionsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.list(user.organizationId, query);
  }

  @Get('definitions/:id')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  getDefinition(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.get(id, user.organizationId);
  }

  @Post('definitions')
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'Crea un proceso nuevo en borrador.' })
  createDefinition(@Body() dto: CreateWorkflowDefinitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.create(dto, user.organizationId, user.id);
  }

  @Post('definitions/validate')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'Todos los problemas de un diseño (errores y advertencias), sin guardar nada.' })
  async validate(@Body() dto: ValidateDefinitionDto, @CurrentUser() user: AuthenticatedUser) {
    return { issues: await this.definitions.validate(dto.graph, dto.trigger, user.organizationId) };
  }

  @Patch('definitions/:id')
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  updateDefinition(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: UpdateWorkflowDefinitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.definitions.update(id, dto, user.organizationId, user.id);
  }

  @Post('definitions/:id/publish')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'Valida y publica una versión, archivando la anterior.' })
  publishDefinition(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: PublishDefinitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.definitions.publish(id, dto ?? {}, user.organizationId, user.id);
  }

  @Post('definitions/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'Retira la versión publicada: no se inician más ejecuciones; las abiertas terminan.' })
  unpublish(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.unpublish(id, user.organizationId);
  }

  @Post('definitions/:id/versions')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'Abre el borrador del proceso (lo crea a partir de esta versión si no existe).' })
  newVersion(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.createVersion(id, user.organizationId, user.id);
  }

  @Post('definitions/:id/duplicate')
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'Copia el proceso como uno nuevo, con su propia clave.' })
  duplicate(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: DuplicateDefinitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.definitions.duplicate(id, dto?.name, user.organizationId, user.id);
  }

  @Delete('definitions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  deleteDefinition(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.definitions.remove(id, user.organizationId);
  }

  // ── Catalogues for the designer ─────────────────────────────────────────────

  @Get('actions')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  @ApiOperation({ summary: 'Las acciones automáticas disponibles, con el esquema de sus parámetros.' })
  actionCatalogue() {
    return this.actions.catalogue();
  }

  @Get('events')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  @ApiOperation({ summary: 'Los eventos de negocio que pueden iniciar un proceso, con sus campos.' })
  eventCatalogue() {
    return {
      customPrefix: CUSTOM_EVENT_PREFIX,
      events: WORKFLOW_EVENT_CATALOGUE.map((event) => ({ key: event.key, group: event.group, fields: event.fields })),
    };
  }

  @Get('assignees')
  @HasPermission(PERMISSIONS.WORKFLOW_DESIGN)
  @ApiOperation({ summary: 'Las personas y los roles de la empresa a los que se puede asignar una tarea.' })
  async assignees(@Query() query: AssigneeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const [users, roles] = await Promise.all([
      this.directory.users(user.organizationId, query.search, query.ids),
      this.directory.roles(user.organizationId),
    ]);
    return { users: users.map(({ id, name, email }) => ({ id, name, email })), roles };
  }

  /**
   * The company's people, for a «person» field in a start form or a task form.
   *
   * Starting a run or answering a task can ask for a person (who receives the goods, who signs
   * off next), and the people filling those forms hold RUN or ACT, not DESIGN — so the full
   * assignee catalogue, which also lists roles, stays a designer's tool and this narrower read
   * accepts any workflow grant. Only active members of the caller's own company, name and email.
   */
  @Get('people')
  @AuthenticatedOnly('Any workflow grant may read; checked in the handler because grants are any-of here.')
  @ApiOperation({ summary: 'Personas de la empresa, para un campo «persona» de un formulario de proceso.' })
  async people(@Query() query: AssigneeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    const grants = [PERMISSIONS.WORKFLOW_VIEW, PERMISSIONS.WORKFLOW_RUN, PERMISSIONS.WORKFLOW_TASK_ACT, PERMISSIONS.WORKFLOW_DESIGN];
    if (!grants.some((grant) => hasPermission(user.permissions ?? [], [grant]))) {
      throw new ForbiddenError('workflow_engine.no_access');
    }
    const users = await this.directory.users(user.organizationId, query.search, query.ids);
    return users.map(({ id, name, email }) => ({ id, name, email }));
  }

  // ── Instances ────────────────────────────────────────────────────────────────

  @Get('instances')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  listInstances(@Query() query: ListInstancesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.instances.list(user.organizationId, query, this.actorOf(user));
  }

  @Get('instances/:id')
  @HasPermission(PERMISSIONS.WORKFLOW_VIEW)
  @ApiOperation({ summary: 'Una ejecución con sus tareas, su cronología y su diseño.' })
  getInstance(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.instances.detail(id, user.organizationId);
  }

  @Post('definitions/:id/start')
  @HasPermission(PERMISSIONS.WORKFLOW_RUN)
  @ApiOperation({ summary: 'Inicia manualmente una ejecución de una versión publicada.' })
  startInstance(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: StartInstanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.instances.start(id, dto, user.organizationId, user.id);
  }

  @Post('instances/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.WORKFLOW_RUN)
  cancelInstance(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CancelInstanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.instances.cancel(id, user.organizationId, user.id, dto.reason);
  }

  @Post('instances/:id/retry')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.WORKFLOW_RUN)
  @ApiOperation({ summary: 'Reanuda una ejecución fallida desde el paso que falló.' })
  retryInstance(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.instances.retry(id, user.organizationId, user.id);
  }

  /**
   * An integration event. Only `custom.*` names are accepted here: the business events (an invoice
   * issued, a quote accepted) are emitted by the modules that own those facts, and letting a caller
   * fire them by hand would let anyone start a process with fabricated document data.
   */
  @Post('events')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.WORKFLOW_RUN)
  @ApiOperation({ summary: 'Dispara un evento de integración (custom.*) que inicia los flujos suscritos.' })
  async fireEvent(@Body() dto: FireEventDto, @CurrentUser() user: AuthenticatedUser) {
    if (!dto.event.startsWith(CUSTOM_EVENT_PREFIX)) throw new BadRequestError('workflow_engine.only_custom_events');
    const started = await this.triggers.fire(user.organizationId, dto.event, {
      context: dto.context,
      subject: dto.subject ?? null,
      actorUserId: user.id,
    });
    return { started };
  }

  // ── Tasks ────────────────────────────────────────────────────────────────────

  @Get('tasks')
  @HasPermission(PERMISSIONS.WORKFLOW_TASK_ACT)
  @ApiOperation({ summary: 'La bandeja de tareas del usuario (abiertas, o completadas por él).' })
  myTasks(@Query('view') view: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.inbox(user.organizationId, this.actorOf(user), view === 'done' ? 'done' : 'open');
  }

  @Get('tasks/:id')
  @HasPermission(PERMISSIONS.WORKFLOW_TASK_ACT)
  async getTask(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const task = await this.tasks.get(id, user.organizationId);
    const actor = this.actorOf(user);
    const involved =
      task.assigneeUserId === actor.userId ||
      task.completedByUserId === actor.userId ||
      (!task.assigneeUserId && !!task.assigneeRoleId && actor.roleIds.includes(task.assigneeRoleId));
    if (!involved && !hasPermission(user.permissions ?? [], [PERMISSIONS.WORKFLOW_VIEW])) {
      throw new ForbiddenError('workflow_engine.not_your_task');
    }
    return task;
  }

  @Post('tasks/:id/complete')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.WORKFLOW_TASK_ACT)
  @ApiOperation({ summary: 'Completa una tarea con un resultado y avanza la ejecución.' })
  completeTask(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CompleteTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.complete(id, user.organizationId, dto, this.actorOf(user));
  }
}
