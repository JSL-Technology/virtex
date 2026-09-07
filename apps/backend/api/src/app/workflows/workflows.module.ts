import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalPolicy } from './entities/approval-policy.entity';
import { ApprovalPolicyStep } from './entities/approval-policy-step.entity';
import { ApprovalRequest } from './entities/approval-request.entity';
import { ApprovalStepAction } from './entities/approval-step-action.entity';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { ApprovalHandlerRegistry } from './approval-handler.registry';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApprovalPolicy,
      ApprovalPolicyStep,
      ApprovalRequest,
      ApprovalStepAction,
    ]),
    // Every decision writes an audit row in the deciding transaction: the chain of authority a
    // multi-step policy creates is only a record if it is written down.
    forwardRef(() => AuditModule),
  ],
  providers: [WorkflowsService, ApprovalHandlerRegistry],
  controllers: [WorkflowsController],
  // The registry is exported so each module that owns an approvable document can register its
  // handler. See `ApprovalHandlerRegistry` for why registration, and not an event.
  exports: [WorkflowsService, ApprovalHandlerRegistry],
})
export class WorkflowsModule {}
