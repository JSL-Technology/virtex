import { Module } from '@nestjs/common';
import { ModuleInboxController } from './module-inbox.controller';
import { ModuleInboxService } from './module-inbox.service';
import { ApprovalsInboxController } from './approvals-inbox.controller';
import { ApprovalsInboxService } from './approvals-inbox.service';

/**
 * The inbox: the approvals the caller may decide and each module's blocked work.
 *
 * `GET /my-work` used to sit here too, returning the decidable subset of the approvals inbox under
 * a second name (with `tasks` and `notifications` always empty). The client has one inbox now, so
 * the duplicate endpoint is gone.
 */
@Module({
  controllers: [ModuleInboxController, ApprovalsInboxController],
  providers: [ModuleInboxService, ApprovalsInboxService],
})
export class MyWorkModule {}
