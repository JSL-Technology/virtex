
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinancialReportingController } from './financial-reporting.controller';
import { FinancialReportingService } from './financial-reporting.service';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { ChartOfAccountsModule } from '../chart-of-accounts/chart-of-accounts.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    // Reading and exporting financial data is recorded; the interceptor lives in AuditModule.
    AuditModule,
    ChartOfAccountsModule,

    TypeOrmModule.forFeature([
      Account,
      JournalEntryLine,
      OrganizationSettings,
    ]),
  ],
  controllers: [FinancialReportingController],
  providers: [FinancialReportingService],

  exports: [FinancialReportingService],
})
export class FinancialReportingModule {}