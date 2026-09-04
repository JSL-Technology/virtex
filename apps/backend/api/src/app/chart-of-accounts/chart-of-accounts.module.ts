
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Account } from './entities/account.entity';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { AccountHistoryController } from './account-history.controller';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { AccountSegment } from './entities/account-segment.entity';
import { AuditModule } from '../audit/audit.module';
import { AccountHistory } from './entities/account-history.entity';
import { AccountSegmentDefinition } from './entities/account-segment-definition.entity';
import { AccountSegmentsService } from './account-segments.service';
import { AccountSegmentsController } from './account-segments.controller';
import { AccountJobsProcessor } from './account-jobs.processor';
import { WebsocketsModule } from '../websockets/websockets.module';

import { AccountHierarchyVersion } from './entities/account-hierarchy-version.entity';
import { AccountBalancesService } from './account-balances.service';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      JournalEntryLine,
      AccountSegment,
      AccountHistory,
      AccountSegmentDefinition,
      AccountHierarchyVersion,
    ]),
    BullModule.registerQueue({ name: 'account-jobs' }),
    forwardRef(() => AuditModule),
    WebsocketsModule,
  ],
  controllers: [
    ChartOfAccountsController,
    AccountSegmentsController,
    // `GET /chart-of-accounts/:accountId/history` — the audit trail of an account's moves through
    // the hierarchy. The controller existed, declared its permission and was in no module, so the
    // route did not exist.
    AccountHistoryController,
  ],
  providers: [
    ChartOfAccountsService,
    AccountBalancesService,
    AccountSegmentsService,
    AccountJobsProcessor,
  ],
  exports: [ChartOfAccountsService, AccountBalancesService, AccountSegmentsService],
})
export class ChartOfAccountsModule {}