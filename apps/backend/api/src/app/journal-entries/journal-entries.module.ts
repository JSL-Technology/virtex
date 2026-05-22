
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { RecurringJournalEntry } from './entities/recurring-journal-entry.entity';
import { JournalEntryTemplate } from './entities/journal-entry-template.entity';
import { JournalEntryAttachment } from './entities/journal-entry-attachment.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { AccountingPeriod } from '../accounting/entities/accounting-period.entity';
import { Journal } from './entities/journal.entity';
import { JournalEntriesService } from './journal-entries.service';
import { RecurringJournalEntriesService } from './recurring-journal-entries.service';
import { JournalEntryTemplatesService } from './journal-entry-templates.service';
import { JournalEntryImportService } from './journal-entry-import.service';
import { FileParserService } from './parsers/file-parser.service';
import { JournalsService } from './journals.service';
import { JournalEntriesController } from './journal-entries.controller';
import { RecurringJournalEntriesController } from './recurring-journal-entries.controller';
import { JournalEntryTemplatesController } from './journal-entry-templates.controller';
import { JournalsController } from './journals.controller';
import { AuthModule } from '../auth/auth.module';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { StorageModule } from '../storage/storage.module';
import { WebsocketsModule } from '../websockets/websockets.module';
import { Ledger } from '../accounting/entities/ledger.entity';
import { AdjustmentsService } from './adjustments.service';
import { AdjustmentsController } from './adjustments.controller';
import { AccountingModule } from '../accounting/accounting.module';
import { AccountPeriodLock } from '../accounting/entities/account-period-lock.entity';
import { WorkflowsModule } from '../workflows/workflows.module';
import { JournalEntryLineValuation } from './entities/journal-entry-line-valuation.entity';
import { DimensionRule } from '../dimensions/entities/dimension-rule.entity';
import { BullModule } from '@nestjs/bullmq';
import { RecurringEntriesProcessor } from './recurring-entries.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalEntry,
      JournalEntryLine,
      JournalEntryLineValuation,
      RecurringJournalEntry,
      JournalEntryTemplate,
      Account,
      JournalEntryAttachment,
      AccountingPeriod,
      Journal,
      Ledger,
      AccountPeriodLock,
      DimensionRule,
    ]),

    BullModule.registerQueue({
      name: 'recurring-entries-processor',
    }),
    forwardRef(() => AuthModule),
    forwardRef(() => ChartOfAccountsModule),
    StorageModule,
    WebsocketsModule,
    forwardRef(() => AccountingModule),
    forwardRef(() => WorkflowsModule),
  ],
  providers: [
    JournalEntriesService,
    RecurringJournalEntriesService,
    JournalEntryTemplatesService,
    JournalEntryImportService,
    FileParserService,
    JournalsService,
    AdjustmentsService,
    RecurringEntriesProcessor,
  ],
  controllers: [
    JournalEntriesController,
    RecurringJournalEntriesController,
    JournalEntryTemplatesController,
    JournalsController,
    AdjustmentsController,
  ],
  exports: [JournalEntriesService],
})
export class JournalEntriesModule {}