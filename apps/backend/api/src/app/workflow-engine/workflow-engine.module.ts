import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowDefinition } from './entities/workflow-definition.entity';
import { WorkflowInstance } from './entities/workflow-instance.entity';
import { WorkflowTask } from './entities/workflow-task.entity';
import { WorkflowTransition } from './entities/workflow-transition.entity';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowInstancesService } from './workflow-instances.service';
import { WorkflowTasksService } from './workflow-tasks.service';
import { WorkflowTimerService } from './workflow-timer.service';
import { WorkflowTriggerService } from './workflow-trigger.service';
import { WorkflowActionRegistry } from './workflow-action.registry';
import { WorkflowDirectoryService } from './workflow-directory.service';
import { WorkflowNotifier } from './workflow-notifier.service';
import { WorkflowSubprocessService } from './workflow-subprocess.service';
import { WorkflowEngineApprovalSource } from './workflow-approval.source';
import { BuiltinWorkflowActions, WorkflowSubprocessStarter } from './actions/builtin-actions';
import { DocumentWorkflowActions } from './actions/document-actions';
import { WorkflowDomainEventsListener } from './events/workflow-domain-events.listener';
import { WorkflowEngineController } from './workflow-engine.controller';

/**
 * The SAP-style Business Workflow engine.
 *
 * It owns its four tables and reaches no operational module: automatic steps run through the
 * {@link WorkflowActionRegistry} (the built-in verbs ship here; a domain registers its own), and
 * business events arrive by name through the application event bus (`contracts/business-events`),
 * so the engine never imports the module that emitted them. `NotificationsModule` is the one
 * collaborator — a sibling in `configuracion` — so a task can tell the people it waits on; the
 * approvals centre reaches workflow approvals through the shared `ApprovalSourceRegistry`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WorkflowDefinition, WorkflowInstance, WorkflowTask, WorkflowTransition]),
    NotificationsModule,
  ],
  providers: [
    WorkflowEngineService,
    WorkflowDefinitionsService,
    WorkflowInstancesService,
    WorkflowTasksService,
    WorkflowTimerService,
    WorkflowTriggerService,
    WorkflowActionRegistry,
    WorkflowDirectoryService,
    WorkflowNotifier,
    WorkflowEngineApprovalSource,
    WorkflowDomainEventsListener,
    BuiltinWorkflowActions,
    DocumentWorkflowActions,
    WorkflowSubprocessService,
    { provide: WorkflowSubprocessStarter, useExisting: WorkflowSubprocessService },
  ],
  controllers: [WorkflowEngineController],
  exports: [WorkflowEngineService, WorkflowActionRegistry, WorkflowTriggerService],
})
export class WorkflowEngineModule {}
