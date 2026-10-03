import { Module } from '@nestjs/common';
import { MyWorkController } from './my-work.controller';
import { MyWorkService } from './my-work.service';
import { ModuleInboxController } from './module-inbox.controller';
import { ModuleInboxService } from './module-inbox.service';
import { ApprovalsInboxController } from './approvals-inbox.controller';
import { ApprovalsInboxService } from './approvals-inbox.service';

@Module({
  controllers: [MyWorkController, ModuleInboxController, ApprovalsInboxController],
  providers: [MyWorkService, ModuleInboxService, ApprovalsInboxService],
})
export class MyWorkModule {}
