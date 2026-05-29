
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Account } from './entities/account.entity';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { BalanceUpdateService } from './balance-update.service';
import { BalanceUpdateProcessor } from './balance-update.processor';
import { AccountBalance } from './entities/account-balance.entity';
import { AccountSegment } from './entities/account-segment.entity';
import { AuditModule } from '../audit/audit.module';
import { AccountHistory } from './entities/account-history.entity';
import { AccountSegmentDefinition } from './entities/account-segment-definition.entity';
import { AccountSegmentsService } from './account-segments.service';
import { AccountSegmentsController } from './account-segments.controller';
import { AccountJobsProcessor } from './account-jobs.processor';
import { WebsocketsModule } from '../websockets/websockets.module';

import { AccountHierarchyVersion } from './entities/account-hierarchy-version.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      JournalEntryLine,
      AccountBalance,
      AccountSegment,
      AccountHistory,
      AccountSegmentDefinition,
      AccountHierarchyVersion,
    ]),
    BullModule.registerQueue(
      { name: 'balance-updates-v2' },
      { name: 'account-jobs' },
    ),
    forwardRef(() => AuditModule),
    WebsocketsModule,
  ],
  controllers: [
    ChartOfAccountsController,
    AccountSegmentsController,
  ],
  providers: [
    ChartOfAccountsService,
    BalanceUpdateService,
    BalanceUpdateProcessor,
    AccountSegmentsService,
    AccountJobsProcessor,
  ],
  exports: [ChartOfAccountsService, BalanceUpdateService, AccountSegmentsService],
})
export class ChartOfAccountsModule {}