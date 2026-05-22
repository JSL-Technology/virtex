
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalPolicy } from './entities/approval-policy.entity';
import { ApprovalPolicyStep } from './entities/approval-policy-step.entity';
import { ApprovalRequest } from './entities/approval-request.entity';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApprovalPolicy, ApprovalPolicyStep, ApprovalRequest]),

    forwardRef(() => AuthModule),
  ],
  providers: [WorkflowsService],
  controllers: [WorkflowsController],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
