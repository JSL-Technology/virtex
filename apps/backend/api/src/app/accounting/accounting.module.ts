
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { PeriodClosingService } from './period-closing.service';
import { AccountingController } from './accounting.controller';
import { AuthModule } from '../auth/auth.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { InflationIndex } from './entities/inflation-index.entity';
import { InflationAdjustmentController } from './inflation-adjustment.controller';
import { InflationAdjustmentService } from './inflation-adjustment.service';
import { FiscalYearArchivingService } from './fiscal-year-archiving.service';
import { FiscalYear } from './entities/fiscal-year.entity';
import { Ledger } from './entities/ledger.entity';
import { LedgersService } from './ledgers.service';
import { LedgersController } from './ledgers.controller';
import { YearEndCloseController } from './year-end-close.controller';
import { YearEndCloseService } from './year-end-close.service';
import { AccountPeriodLock } from './entities/account-period-lock.entity';
import { AuditModule } from '../audit/audit.module';
import { ClosingAutomationService } from './closing-automation.service';
import { ResultTransferService } from './result-transfer.service';
import { DepreciationModule } from '../fixed-assets/depreciation.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { LedgerMappingRule } from './entities/ledger-mapping-rule.entity';
import { LedgerMappingService } from './ledger-mapping.service';
import { LedgerMappingController } from './ledger-mapping.controller';
import { LedgerMappingRuleCondition } from './entities/ledger-mapping-rule-condition.entity';
import { ClosingChecklistService } from './closing-checklist.service';
import { TenantBookkeepingProvisioner } from './provisioning/tenant-bookkeeping.provisioner';
import { PeriodLockModule } from './period-lock.module';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { FiscalCalendarService } from './fiscal-calendar.service';
import { LedgerLookupService } from './services/ledger-lookup.service';
import { CurrencyRevaluationService } from './services/currency-revaluation.service';
import { OrganizationProvisioningHandler } from './handlers/organization-provisioning.handler';
import { AccountingInboxProvider } from './inbox/accounting-inbox.provider';


@Module({
  imports: [
    PeriodLockModule,
    // None of the modules below import AccountingModule back — forwardRef was defensive.
    ChartOfAccountsModule,
    // Only entities this module owns.
    TypeOrmModule.forFeature([
      // La bandeja de Contabilidad cuenta los asientos en borrador. `journal-entries` es del
      // mismo módulo de negocio —contabilidad— así que esto no cruza ninguna frontera.
      JournalEntry,
      AccountingPeriod,
      InflationIndex,
      FiscalYear,
      Ledger,
      AccountPeriodLock,
      LedgerMappingRule,
      LedgerMappingRuleCondition,
    ]),
    // `forwardRef` because AuthModule reaches OrganizationsModule, which reaches this module
    // through LocalizationProvisioningModule — so AuthModule's class expression is still being
    // evaluated when this one is defined, and the import resolves to `undefined`.
    forwardRef(() => AuthModule),
    JournalEntriesModule,
    AuditModule,
    // DepreciationModule is a leaf — no upstream dependency on AccountingModule.
    DepreciationModule,
    CurrenciesModule,
  ],
  providers: [
    AccountingInboxProvider,
    PeriodClosingService,
    InflationAdjustmentService,
    FiscalYearArchivingService,
    LedgersService,
    YearEndCloseService,
    ClosingAutomationService,
    ResultTransferService,
    ClosingChecklistService,
    LedgerMappingService,
    TenantBookkeepingProvisioner,
    FiscalCalendarService,
    LedgerLookupService,
    CurrencyRevaluationService,
    OrganizationProvisioningHandler,
  ],
  controllers: [
    AccountingController,
    InflationAdjustmentController,
    LedgersController,
    YearEndCloseController,
    LedgerMappingController,
  ],
  exports: [
    // Re-export so callers that import AccountingModule get PeriodLockGuard without changes.
    PeriodLockModule,
    LedgerMappingService,
    // The one implementation of the general ledger. `ReportsService` delegates to it rather than
    // keeping a second one with different semantics.
    LedgersService,
    // Provisioning belongs to accounting. SharedModule used to own it; it now delegates here.
    TenantBookkeepingProvisioner,
    FiscalCalendarService,
    LedgerLookupService,
    CurrencyRevaluationService,
  ],
})
export class AccountingModule {}