
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { RecurringJournalEntry } from './entities/recurring-journal-entry.entity';
import { JournalEntryTemplate } from './entities/journal-entry-template.entity';
import { JournalEntryAttachment } from './entities/journal-entry-attachment.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { Journal } from './entities/journal.entity';
import { JournalEntriesService } from './journal-entries.service';
import { AccountingPostingPort } from './accounting-posting.port';
import { LedgerNarrativeService } from './ledger-narrative.service';
import { RecurringJournalEntriesService } from './recurring-journal-entries.service';
import { JournalEntryTemplatesService } from './journal-entry-templates.service';
import { JournalEntryImportService } from './journal-entry-import.service';
import { JournalEntryImportBatch } from './entities/journal-entry-import-batch.entity';
import { FileParserService } from './parsers/file-parser.service';
import { JournalsService } from './journals.service';
import { JournalEntriesController } from './journal-entries.controller';
import { RecurringJournalEntriesController } from './recurring-journal-entries.controller';
import { JournalEntryTemplatesController } from './journal-entry-templates.controller';
import { JournalsController } from './journals.controller';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { StorageModule } from '../storage/storage.module';
import { WebsocketsModule } from '../websockets/websockets.module';
import { Ledger } from '../accounting/entities/ledger.entity';
import { AdjustmentsService } from './adjustments.service';
import { AdjustmentsController } from './adjustments.controller';
import { PeriodLockModule } from '../accounting/period-lock.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { JournalEntryLineValuation } from './entities/journal-entry-line-valuation.entity';
import { DimensionRule } from '../dimensions/entities/dimension-rule.entity';
import { BullModule } from '@nestjs/bullmq';
import { RecurringEntriesProcessor } from './recurring-entries.processor';
import { JournalEntrySequence } from './entities/journal-entry-sequence.entity';
import { JournalEntryNumberingService } from './journal-entry-numbering.service';
import { AuditModule } from '../audit/audit.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { JournalEntryApprovalHandler } from './journal-entry-approval.handler';
import { JournalLookupService } from './services/journal-lookup.service';
import { JournalQueryService } from './services/journal-query.service';

@Module({
  imports: [
    // The budget stops an expense typed into the journal exactly as it stops the same expense
    // arriving as a supplier bill. Without it the control was one screen away from being bypassed.
    BudgetsModule,
    TypeOrmModule.forFeature([
      JournalEntry,
      JournalEntryLine,
      JournalEntryLineValuation,
      RecurringJournalEntry,
      JournalEntryTemplate,
      Account,
      JournalEntryAttachment,
      Journal,
      Ledger,
      DimensionRule,
      JournalEntrySequence,
      JournalEntryImportBatch,
    ]),

    BullModule.registerQueue({
      name: 'recurring-entries-processor',
    }),
    forwardRef(() => ChartOfAccountsModule),
    StorageModule,
    WebsocketsModule,
    // Import only the guard, not the full AccountingModule — breaking the forwardRef cycle.
    PeriodLockModule,
    forwardRef(() => WorkflowsModule),
    forwardRef(() => AuditModule),
    // The posting path resolves its own exchange rate now instead of taking one from the
    // request. `CurrenciesModule` already forward-references this one, so the cycle is declared
    // on both sides.
    forwardRef(() => CurrenciesModule),
  ],
  providers: [
    JournalEntriesService,
    // The narrow posting contract that subledgers (inventory, payroll, AP) inject. Binding it
    // here — in the module that controls the implementation — means subledgers never depend on the
    // full service, only on the port.
    { provide: AccountingPostingPort, useExisting: JournalEntriesService },
    // The narrative on a system-generated entry, in the tenant's books language.
    LedgerNarrativeService,
    JournalEntryNumberingService,
    RecurringJournalEntriesService,
    JournalEntryTemplatesService,
    JournalEntryImportService,
    FileParserService,
    JournalsService,
    AdjustmentsService,
    RecurringEntriesProcessor,
    // Posts an entry when its approval is granted, inside the approving transaction.
    JournalEntryApprovalHandler,
    JournalLookupService,
    JournalQueryService,
  ],
  controllers: [
    JournalEntriesController,
    RecurringJournalEntriesController,
    JournalEntryTemplatesController,
    JournalsController,
    AdjustmentsController,
  ],
  // `FileParserService` is exported because `CoaImportService` injects it and reaches it through
  // this module. It was provided here and not exported, so `CoaImportModule` could not resolve
  // it and the application refused to start — `Nest can't resolve dependencies of the
  // CoaImportService (…, ?, …)`.
  exports: [
    JournalEntriesService,
    // Also export the port so subledgers can inject it by the abstract-class token.
    AccountingPostingPort,
    JournalEntryNumberingService,
    FileParserService,
    LedgerNarrativeService,
    // `AuditAdjustmentsService` posts an approved audit adjustment through this service. It could
    // not reach it while the service was provided here and not exported — one of the reasons the
    // audit-adjustment feature was never wired into a module at all.
    AdjustmentsService,
    JournalLookupService,
    JournalQueryService,
  ],
})
export class JournalEntriesModule {}