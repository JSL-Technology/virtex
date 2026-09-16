
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
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


@Module({
  imports: [
    PeriodLockModule,
    forwardRef(() => ChartOfAccountsModule),
    // Only entities this module owns.
    TypeOrmModule.forFeature([
      AccountingPeriod,
      InflationIndex,
      FiscalYear,
      Ledger,
      AccountPeriodLock,
      LedgerMappingRule,
      LedgerMappingRuleCondition,
      // Account belongs to chart-of-accounts — accessed via DataSource in services that need it.
      // Organization/OrganizationSettings belong to organizations — accessed via OrgSettingsService
      // (globally available) or DataSource.manager for bulk queries.
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => JournalEntriesModule),
    forwardRef(() => AuditModule),
    // DepreciationModule is a leaf — no upstream dependency on AccountingModule.
    // The cycle Accounting ↔ FixedAssets is broken by this import.
    DepreciationModule,
    forwardRef(() => CurrenciesModule),
  ],
  providers: [
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