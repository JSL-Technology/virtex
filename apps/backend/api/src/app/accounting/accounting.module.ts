
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountingPeriod } from './entities/accounting-period.entity';
import { PeriodClosingService } from './period-closing.service';
import { AccountingController } from './accounting.controller';
import { AuthModule } from '../auth/auth.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { InflationIndex } from './entities/inflation-index.entity';
import { InflationAdjustmentController } from './inflation-adjustment.controller';
import { InflationAdjustmentService } from './inflation-adjustment.service';
import { Organization } from '../organizations/entities/organization.entity';
import { FiscalYearArchivingService } from './fiscal-year-archiving.service';
import { FiscalYear } from './entities/fiscal-year.entity';
import { Ledger } from './entities/ledger.entity';
import { LedgersService } from './ledgers.service';
import { LedgersController } from './ledgers.controller';
import { YearEndCloseController } from './year-end-close.controller';
import { YearEndCloseService } from './year-end-close.service';
import { AccountPeriodLock } from './entities/account-period-lock.entity';
import { PeriodLockGuard } from './guards/period-lock.guard';
import { AuditModule } from '../audit/audit.module';
import { ClosingAutomationService } from './closing-automation.service';
import { FixedAssetsModule } from '../fixed-assets/fixed-assets.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { LedgerMappingRule } from './entities/ledger-mapping-rule.entity';
import { LedgerMappingService } from './ledger-mapping.service';
import { LedgerMappingController } from './ledger-mapping.controller';

import { LedgerMappingRuleCondition } from './entities/ledger-mapping-rule-condition.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountingPeriod,
      Account,
      JournalEntry,
      JournalEntryLine,
      OrganizationSettings,
      InflationIndex,
      Organization,
      FiscalYear,
      Ledger,
      AccountPeriodLock,
      LedgerMappingRule,
      LedgerMappingRuleCondition,
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => JournalEntriesModule),
    forwardRef(() => AuditModule),
    forwardRef(() => FixedAssetsModule),
    forwardRef(() => CurrenciesModule),
  ],
  providers: [
    PeriodClosingService,
    InflationAdjustmentService,
    FiscalYearArchivingService,
    LedgersService,
    YearEndCloseService,
    PeriodLockGuard,
    ClosingAutomationService,
    LedgerMappingService,
  ],
  controllers: [
    AccountingController,
    InflationAdjustmentController,
    LedgersController,
    YearEndCloseController,
    LedgerMappingController,
  ],
  exports: [
    PeriodLockGuard,
    LedgerMappingService,
  ],
})
export class AccountingModule {}