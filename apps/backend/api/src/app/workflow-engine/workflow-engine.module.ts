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
import { BuiltinWorkflowActions } from './actions/builtin-actions';
import { WorkflowEngineController } from './workflow-engine.controller';

/**
 * The SAP-style Business Workflow engine.
 *
 * It owns its four tables and reaches no operational module: automatic steps run through the
 * {@link WorkflowActionRegistry} (the built-in verbs ship here; a domain registers its own), and
 * events arrive through {@link WorkflowTriggerService}, which is exported so a module can start a
 * process from one of its facts without the engine ever importing it. `NotificationsModule` is the
 * one collaborator — a sibling in `configuracion` — so a task can tell the person it waits on.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowDefinition,
      WorkflowInstance,
      WorkflowTask,
      WorkflowTransition,
    ]),
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
    BuiltinWorkflowActions,
  ],
  controllers: [WorkflowEngineController],
  exports: [WorkflowEngineService, WorkflowActionRegistry, WorkflowTriggerService],
})
export class WorkflowEngineModule {}
